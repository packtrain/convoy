use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::agents::login_shell;

/// The CLI's own SIGTERM shutdown drains workers (20s cap) and posts
/// /api/agent/disconnect; give it room before escalating to SIGKILL.
const GRACEFUL_STOP_TIMEOUT_MS: u64 = 25_000;
/// App quit can't wait that long; short grace, then hard kill.
const EXIT_STOP_TIMEOUT_MS: u64 = 2_000;

// Whitelist of spawnable CLI binaries; "convoy-dev" is the developer's
// source-checkout alias. Only these fixed strings ever reach the shell.
const CLI_BINS: [&str; 2] = ["convoy", "convoy-dev"];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedProcessRecord {
    profile_key: String,
    pid: u32,
    process_group_id: i32,
    started_at: String,
}

struct ManagedProcess {
    record: ManagedProcessRecord,
    child: Option<Child>,
}

/// Desktop-managed connections keyed by profile. A live record may have no
/// Child handle when it was recovered after the desktop app crashed.
pub struct AgentProcesses(Mutex<HashMap<String, ManagedProcess>>);

impl Default for AgentProcesses {
    fn default() -> Self {
        let entries = scan_process_table_uncached();
        let managed = read_process_registry()
            .into_iter()
            .filter(|record| record_matches_process(record, &entries))
            .map(|record| {
                (
                    record.profile_key.clone(),
                    ManagedProcess {
                        record,
                        child: None,
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        persist_process_registry(&managed);
        Self(Mutex::new(managed))
    }
}

#[derive(Clone, Debug)]
struct ProcessEntry {
    pid: u32,
    parent_pid: u32,
    process_group_id: i32,
    started_at: String,
    command: String,
    profile_key: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentInfo {
    pub id: String,
    pub pid: u32,
    pub process_group_id: i32,
    pub profile_key: Option<String>,
    pub working_directory: Option<String>,
    pub started_at: String,
    pub process_count: usize,
    pub managed: bool,
}

#[derive(Clone, Debug)]
struct LocalAgent {
    info: LocalAgentInfo,
    process_ids: Vec<u32>,
    owns_process_group: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub ok: bool,
    pub error: Option<String>,
}

fn process_registry_path() -> Option<PathBuf> {
    crate::config::config_path().and_then(|path| {
        path.parent()
            .map(|parent| parent.join("desktop-processes.json"))
    })
}

fn read_process_registry() -> Vec<ManagedProcessRecord> {
    let Some(path) = process_registry_path() else {
        return Vec::new();
    };
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn persist_process_registry(managed: &HashMap<String, ManagedProcess>) {
    let Some(path) = process_registry_path() else {
        return;
    };
    let mut records = managed
        .values()
        .map(|process| process.record.clone())
        .collect::<Vec<_>>();
    records.sort_by(|a, b| a.profile_key.cmp(&b.profile_key));
    let Ok(bytes) = serde_json::to_vec_pretty(&records) else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let temporary = parent.join(format!(".desktop-processes-{}.tmp", std::process::id()));
    if fs::write(&temporary, bytes).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600));
    }
    if fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(temporary);
    }
}

fn parse_ps_line(line: &str) -> Option<ProcessEntry> {
    let tokens = line.split_whitespace().collect::<Vec<_>>();
    if tokens.len() < 9 {
        return None;
    }
    let pid = tokens[0].parse().ok()?;
    let parent_pid = tokens[1].parse().ok()?;
    let process_group_id = tokens[2].parse().ok()?;
    let started_at = tokens[3..8].join(" ");
    let command = tokens[8..].join(" ");
    let profile_key = extract_profile_key(&command);
    Some(ProcessEntry {
        pid,
        parent_pid,
        process_group_id,
        started_at,
        command,
        profile_key,
    })
}

/// `ps` forks a process and parses the whole system process table, so the
/// idle polls used to pay for it several times a second. Commands that fire
/// close together now share one scan. Kept just under the fastest UI poll
/// (3s, Settings) so a visible panel still refreshes every tick while the
/// concurrent tray/Advanced polls ride along on one scan.
const PROCESS_TABLE_TTL: Duration = Duration::from_millis(2_500);

static PROCESS_TABLE_CACHE: Mutex<Option<(Instant, Vec<ProcessEntry>)>> = Mutex::new(None);

fn run_ps() -> Vec<ProcessEntry> {
    let Ok(output) = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,pgid=,lstart=,command="])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_ps_line)
        .collect()
}

fn scan_process_table() -> Vec<ProcessEntry> {
    let mut cache = PROCESS_TABLE_CACHE.lock().unwrap();
    if let Some((captured_at, entries)) = cache.as_ref() {
        if captured_at.elapsed() < PROCESS_TABLE_TTL {
            return entries.clone();
        }
    }
    let entries = run_ps();
    *cache = Some((Instant::now(), entries.clone()));
    entries
}

/// Lifecycle transitions (spawn, stop) must observe the real table, not a
/// snapshot taken up to `PROCESS_TABLE_TTL` ago.
fn scan_process_table_uncached() -> Vec<ProcessEntry> {
    let entries = run_ps();
    *PROCESS_TABLE_CACHE.lock().unwrap() = Some((Instant::now(), entries.clone()));
    entries
}

fn process_entry(pid: u32) -> Option<ProcessEntry> {
    for _ in 0..5 {
        if let Some(entry) = scan_process_table_uncached()
            .into_iter()
            .find(|entry| entry.pid == pid)
        {
            return Some(entry);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}

fn normalized_command_token(token: &str) -> &str {
    token.trim_matches(|character| {
        matches!(
            character,
            '\'' | '"' | '`' | '(' | ')' | '[' | ']' | '{' | '}' | ';' | ','
        )
    })
}

fn is_convoy_connect(command: &str) -> bool {
    let tokens = command
        .split_whitespace()
        .map(normalized_command_token)
        .collect::<Vec<_>>();
    let has_convoy = tokens.iter().any(|token| {
        let basename = token.rsplit('/').next().unwrap_or(token);
        matches!(
            basename,
            "convoy" | "convoy-dev" | "convoy.js" | "convoy.ts"
        )
    });
    has_convoy && tokens.contains(&"connect")
}

fn extract_profile_key(command: &str) -> Option<String> {
    let tokens = command.split_whitespace().collect::<Vec<_>>();
    for (index, token) in tokens.iter().enumerate() {
        let token = normalized_command_token(token);
        let candidate = if token == "--profile" {
            tokens
                .get(index + 1)
                .map(|value| normalized_command_token(value))
        } else {
            token.strip_prefix("--profile=")
        };
        if let Some(candidate) = candidate {
            if is_valid_profile_key(candidate) {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn record_matches_process(record: &ManagedProcessRecord, entries: &[ProcessEntry]) -> bool {
    entries.iter().any(|entry| {
        entry.pid == record.pid
            && entry.process_group_id == record.process_group_id
            && entry.started_at == record.started_at
            && entry.profile_key.as_deref() == Some(record.profile_key.as_str())
            && is_convoy_connect(&entry.command)
    })
}

fn read_process_cwd(pid: u32) -> Option<String> {
    #[cfg(target_os = "macos")]
    let executable = "/usr/sbin/lsof";
    #[cfg(not(target_os = "macos"))]
    let executable = "lsof";

    let output = Command::new(executable)
        .args(["-nP", "-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(str::to_string))
}

fn discover_local_agents(
    entries: &[ProcessEntry],
    managed: &HashMap<String, ManagedProcess>,
    include_working_directory: bool,
) -> Vec<LocalAgent> {
    let candidates = entries
        .iter()
        .filter(|entry| is_convoy_connect(&entry.command))
        .collect::<Vec<_>>();
    let candidate_ids = candidates
        .iter()
        .map(|entry| entry.pid)
        .collect::<HashSet<_>>();
    let mut groups: HashMap<i32, Vec<&ProcessEntry>> = HashMap::new();
    for entry in candidates {
        groups
            .entry(entry.process_group_id)
            .or_default()
            .push(entry);
    }

    let mut agents = groups
        .into_iter()
        .filter_map(|(process_group_id, mut group)| {
            group.sort_by_key(|entry| entry.pid);
            let representative = group
                .iter()
                .find(|entry| entry.pid as i32 == process_group_id)
                .or_else(|| {
                    group
                        .iter()
                        .find(|entry| !candidate_ids.contains(&entry.parent_pid))
                })
                .copied()
                .or_else(|| group.first().copied())?;
            let profile_keys = group
                .iter()
                .filter_map(|entry| entry.profile_key.clone())
                .collect::<HashSet<_>>();
            let profile_key = if profile_keys.len() == 1 {
                profile_keys.into_iter().next()
            } else {
                None
            };
            let process_ids = group.iter().map(|entry| entry.pid).collect::<Vec<_>>();
            let managed = managed.values().any(|process| {
                process.record.process_group_id == process_group_id
                    && process.record.pid == representative.pid
                    && process.record.started_at == representative.started_at
                    && profile_key.as_deref() == Some(process.record.profile_key.as_str())
            });
            let id = format!(
                "{}:{}:{}",
                process_group_id,
                representative.pid,
                representative.started_at.replace(' ', "_")
            );
            Some(LocalAgent {
                info: LocalAgentInfo {
                    id,
                    pid: representative.pid,
                    process_group_id,
                    profile_key,
                    working_directory: include_working_directory
                        .then(|| read_process_cwd(representative.pid))
                        .flatten(),
                    started_at: representative.started_at.clone(),
                    process_count: process_ids.len(),
                    managed,
                },
                process_ids,
                owns_process_group: representative.pid as i32 == process_group_id,
            })
        })
        .collect::<Vec<_>>();
    agents.sort_by_key(|agent| agent.info.pid);
    agents
}

fn reconcile_managed(managed: &mut HashMap<String, ManagedProcess>, entries: &[ProcessEntry]) {
    let previous_len = managed.len();
    managed.retain(|_, process| {
        if let Some(child) = process.child.as_mut() {
            if !matches!(child.try_wait(), Ok(None)) {
                return false;
            }
        }
        record_matches_process(&process.record, entries)
    });
    if managed.len() != previous_len {
        persist_process_registry(managed);
    }
}

// Matches the CLI profile key pattern ^[a-z][a-z0-9_-]*$. The key is
// interpolated into a shell string, so this strict check is the injection guard.
fn is_valid_profile_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

#[tauri::command]
pub async fn start_agent(
    state: State<'_, AgentProcesses>,
    profile_key: String,
    cli_bin: Option<String>,
    verbose_logging: Option<bool>,
) -> Result<StartResult, String> {
    if !is_valid_profile_key(&profile_key) {
        return Ok(StartResult {
            ok: false,
            error: Some("invalid-profile-key".to_string()),
        });
    }

    let bin = cli_bin.unwrap_or_else(|| "convoy".to_string());
    if !CLI_BINS.contains(&bin.as_str()) {
        return Ok(StartResult {
            ok: false,
            error: Some("invalid-cli-bin".to_string()),
        });
    }

    let entries = scan_process_table_uncached();
    {
        let mut guard = state.0.lock().unwrap();
        reconcile_managed(&mut guard, &entries);
        let already_running = discover_local_agents(&entries, &guard, false)
            .iter()
            .any(|agent| agent.info.profile_key.as_deref() == Some(profile_key.as_str()));
        if already_running {
            // A desktop-managed, recovered, or independently launched
            // connection already owns this profile.
            return Ok(StartResult {
                ok: true,
                error: None,
            });
        }
    }

    // NEVER use an interactive shell (-i) here: without a controlling TTY the
    // kernel stops it (SIGTTIN, state T) before it runs anything. That rules
    // out .zshrc aliases — "convoy-dev" instead runs tsx straight from the
    // source tree (dev builds only).
    let launch = if bin == "convoy-dev" {
        match dev_cli_command() {
            Some(command) => command,
            None => {
                return Ok(StartResult {
                    ok: false,
                    error: Some("cli-not-found".to_string()),
                })
            }
        }
    } else {
        let cli_found = tauri::async_runtime::spawn_blocking(|| {
            Command::new(login_shell())
                .arg("-lc")
                .arg("command -v convoy")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .await
        .unwrap_or(false);
        if !cli_found {
            return Ok(StartResult {
                ok: false,
                error: Some("cli-not-found".to_string()),
            });
        }
        "convoy".to_string()
    };

    // CONVOY_CLI_DEBUG=1 logs a line per stream chunk, which is what makes
    // the daily log grow by gigabytes on a busy day. Opt-in (Advanced →
    // "Verbose agent logging"); the start header and stderr land either way.
    let verbose_logging = verbose_logging.unwrap_or(false);

    // Child output (NDJSON events on stdout, human logs on stderr) goes to
    // the debug log so failures inside the shell/CLI are inspectable.
    let (log_out, log_err) = open_log(&launch, &profile_key, verbose_logging);

    // Own process group: the shell wrapper forks the actual CLI, so signals
    // must target the group or the CLI survives the shell's death.
    let mut command = Command::new(login_shell());
    command
        .arg("-lc")
        .arg(format!("{launch} connect --json --profile {profile_key}"))
        .stdin(Stdio::null())
        .stdout(log_out.map(Stdio::from).unwrap_or_else(Stdio::null))
        .stderr(log_err.map(Stdio::from).unwrap_or_else(Stdio::null))
        .process_group(0);
    if verbose_logging {
        command.env("CONVOY_CLI_DEBUG", "1");
    }
    let spawned = command.spawn();
    match spawned {
        Ok(mut child) => {
            let pid = child.id();
            let Some(entry) = process_entry(pid) else {
                // Without a stable process identity the child cannot be
                // recovered safely after a crash. It has only just spawned,
                // so fail fast instead of leaving an untracked connection.
                signal_process_group(pid as i32, libc::SIGKILL);
                let _ = child.wait();
                return Ok(StartResult {
                    ok: false,
                    error: Some("Could not read the spawned agent process".to_string()),
                });
            };
            let record = ManagedProcessRecord {
                profile_key: profile_key.clone(),
                pid,
                process_group_id: entry.process_group_id,
                started_at: entry.started_at,
            };
            let mut guard = state.0.lock().unwrap();
            guard.insert(
                profile_key,
                ManagedProcess {
                    record,
                    child: Some(child),
                },
            );
            persist_process_registry(&guard);
            Ok(StartResult {
                ok: true,
                error: None,
            })
        }
        Err(e) => Ok(StartResult {
            ok: false,
            error: Some(e.to_string()),
        }),
    }
}

/// Dev builds run the CLI straight from the source checkout the app was
/// compiled in (CARGO_MANIFEST_DIR = apps/desktop/src-tauri → repo root is
/// three levels up). Paths are single-quoted for the shell string.
#[cfg(debug_assertions)]
fn dev_cli_command() -> Option<String> {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.ancestors().nth(3)?;
    let tsx = root.join("node_modules/.bin/tsx");
    let entry = root.join("apps/cli/bin/convoy.ts");
    if !tsx.exists() || !entry.exists() {
        return None;
    }
    Some(format!("'{}' '{}'", tsx.display(), entry.display()))
}

/// Release builds only ever spawn the published `convoy` binary.
#[cfg(not(debug_assertions))]
fn dev_cli_command() -> Option<String> {
    None
}

fn log_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".config").join("convoy").join("logs"))
}

fn today_string() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe {
        libc::localtime_r(&now, &mut tm);
    }
    format!(
        "{:04}-{:02}-{:02}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday
    )
}

/// One file per local day. A run that crosses midnight keeps writing to the
/// day it started on (the fd is fixed at spawn) — fine for a debug log.
fn log_path() -> Option<PathBuf> {
    log_dir().map(|dir| dir.join(format!("desktop-agent-{}.log", today_string())))
}

const LOG_RETENTION_DAYS: u64 = 7;

fn prune_old_logs(dir: &PathBuf) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now() - Duration::from_secs(LOG_RETENTION_DAYS * 24 * 60 * 60);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("desktop-agent-") || !name.ends_with(".log") {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|m| m < cutoff)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Today's log is append-only across every start, so without a cap a long
/// day of verbose agent output grows without bound. Past the cap the file is
/// truncated and restarted rather than rotated — it is a debug tail, and the
/// in-app viewer only ever shows the last 16 KB.
const LOG_MAX_BYTES: u64 = 64 * 1024 * 1024;

fn truncate_log_if_oversized(path: &PathBuf) {
    let Ok(metadata) = std::fs::metadata(path) else {
        return;
    };
    if metadata.len() <= LOG_MAX_BYTES {
        return;
    }
    let _ = File::options().write(true).truncate(true).open(path);
}

/// Appends to today's log file with a per-start header; returns two handles
/// (stdout/stderr) into the same file. Logs older than the retention window
/// are pruned on each start, and an oversized current log is restarted.
fn open_log(launch: &str, profile_key: &str, verbose: bool) -> (Option<File>, Option<File>) {
    let Some(dir) = log_dir() else {
        return (None, None);
    };
    let _ = std::fs::create_dir_all(&dir);
    prune_old_logs(&dir);
    let Some(path) = log_path() else {
        return (None, None);
    };
    truncate_log_if_oversized(&path);
    let Ok(mut file) = File::options().create(true).append(true).open(&path) else {
        return (None, None);
    };
    let epoch_s = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(
        file,
        "[desktop] start epoch={epoch_s} cmd=`{launch} connect --json --profile {profile_key}` shell={} -lc verbose={verbose}",
        login_shell()
    );
    let second = file.try_clone().ok();
    (Some(file), second)
}

const LOG_TAIL_BYTES: u64 = 16 * 1024;

/// Tail of the debug log for the in-app viewer. The viewer polls this every
/// 2s while open, so it seeks to the last `LOG_TAIL_BYTES` instead of reading
/// the file into memory — a busy day's log can be gigabytes.
#[tauri::command]
pub fn read_agent_log() -> String {
    let Some(path) = log_path() else {
        return String::new();
    };
    let Ok(mut file) = File::open(&path) else {
        return String::new();
    };
    let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
        return String::new();
    };
    let start = length.saturating_sub(LOG_TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut bytes = Vec::with_capacity(length.min(LOG_TAIL_BYTES) as usize);
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    // A mid-file seek can land inside a UTF-8 sequence or a line; drop the
    // partial leading line so the viewer never shows a mangled first row.
    let text = String::from_utf8_lossy(&bytes);
    if start == 0 {
        return text.into_owned();
    }
    match text.find('\n') {
        Some(index) => text[index + 1..].to_string(),
        None => text.into_owned(),
    }
}

#[tauri::command]
pub async fn stop_agent(
    state: State<'_, AgentProcesses>,
    profile_key: String,
) -> Result<(), String> {
    let entries = scan_process_table_uncached();
    let (target, child) = {
        let mut guard = state.0.lock().unwrap();
        reconcile_managed(&mut guard, &entries);
        let matches = discover_local_agents(&entries, &guard, false)
            .into_iter()
            .filter(|agent| agent.info.profile_key.as_deref() == Some(profile_key.as_str()))
            .collect::<Vec<_>>();
        if matches.len() > 1 {
            return Err("multiple-local-agents".to_string());
        }
        let Some(target) = matches.into_iter().next() else {
            return Ok(());
        };
        let child = guard
            .get_mut(&profile_key)
            .filter(|process| managed_process_matches_agent(process, &target))
            .and_then(|process| process.child.take());
        (target, child)
    };
    tauri::async_runtime::spawn_blocking(move || {
        stop_targets(
            vec![StopTarget {
                agent: target,
                child,
            }],
            GRACEFUL_STOP_TIMEOUT_MS,
        );
    })
    .await
    .map_err(|e| e.to_string())?;
    let entries = scan_process_table_uncached();
    let mut guard = state.0.lock().unwrap();
    if guard
        .get(&profile_key)
        .is_some_and(|process| !record_matches_process(&process.record, &entries))
    {
        guard.remove(&profile_key);
    }
    persist_process_registry(&guard);
    Ok(())
}

#[tauri::command]
pub fn list_local_agents(state: State<'_, AgentProcesses>) -> Vec<LocalAgentInfo> {
    let entries = scan_process_table();
    let mut guard = state.0.lock().unwrap();
    reconcile_managed(&mut guard, &entries);
    discover_local_agents(&entries, &guard, true)
        .into_iter()
        .map(|agent| agent.info)
        .collect()
}

#[tauri::command]
pub async fn stop_local_agent(state: State<'_, AgentProcesses>, id: String) -> Result<(), String> {
    let entries = scan_process_table_uncached();
    let (target, managed_profile, child) = {
        let mut guard = state.0.lock().unwrap();
        reconcile_managed(&mut guard, &entries);
        let target = discover_local_agents(&entries, &guard, false)
            .into_iter()
            .find(|agent| agent.info.id == id)
            .ok_or("local-agent-not-found")?;
        let managed_profile = guard.iter().find_map(|(profile_key, process)| {
            managed_process_matches_agent(process, &target).then(|| profile_key.clone())
        });
        let child = managed_profile
            .as_ref()
            .and_then(|profile_key| guard.get_mut(profile_key))
            .and_then(|process| process.child.take());
        (target, managed_profile, child)
    };
    tauri::async_runtime::spawn_blocking(move || {
        stop_targets(
            vec![StopTarget {
                agent: target,
                child,
            }],
            GRACEFUL_STOP_TIMEOUT_MS,
        );
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Some(profile_key) = managed_profile {
        let entries = scan_process_table_uncached();
        let mut guard = state.0.lock().unwrap();
        if guard
            .get(&profile_key)
            .is_some_and(|process| !record_matches_process(&process.record, &entries))
        {
            guard.remove(&profile_key);
        }
        persist_process_registry(&guard);
    }
    Ok(())
}

fn managed_process_matches_agent(process: &ManagedProcess, agent: &LocalAgent) -> bool {
    process.record.pid == agent.info.pid
        && process.record.process_group_id == agent.info.process_group_id
        && process.record.started_at == agent.info.started_at
        && agent.info.profile_key.as_deref() == Some(process.record.profile_key.as_str())
}

struct StopTarget {
    agent: LocalAgent,
    child: Option<Child>,
}

fn signal_process_group(process_group_id: i32, signal: libc::c_int) {
    unsafe {
        libc::kill(-process_group_id, signal);
    }
}

fn signal_process(pid: u32, signal: libc::c_int) {
    unsafe {
        libc::kill(pid as libc::pid_t, signal);
    }
}

fn signal_target(target: &LocalAgent, signal: libc::c_int) {
    if target.owns_process_group {
        signal_process_group(target.info.process_group_id, signal);
        return;
    }
    for pid in &target.process_ids {
        signal_process(*pid, signal);
    }
}

fn process_exists(pid: libc::pid_t) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

fn target_is_alive(target: &mut StopTarget) -> bool {
    if let Some(child) = target.child.as_mut() {
        let _ = child.try_wait();
    }
    if target.agent.owns_process_group {
        return process_exists(-target.agent.info.process_group_id);
    }
    target
        .agent
        .process_ids
        .iter()
        .any(|pid| process_exists(*pid as libc::pid_t))
}

/// SIGTERM all targets first, then escalate stragglers to SIGKILL after one
/// shared timeout. Desktop-owned groups are signalled as a whole; for a
/// discovered process whose group leader is unrelated, only the identified
/// `convoy connect` processes are touched.
fn stop_targets(mut targets: Vec<StopTarget>, timeout_ms: u64) {
    for target in &targets {
        signal_target(&target.agent, libc::SIGTERM);
    }
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        targets.retain_mut(target_is_alive);
        if targets.is_empty() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    for target in &targets {
        signal_target(&target.agent, libc::SIGKILL);
    }
    for mut target in targets {
        if let Some(child) = target.child.as_mut() {
            let _ = child.wait();
        }
    }
}

/// Profile keys with a live local connection. This includes recovered
/// desktop children and independently launched local processes, which keeps
/// profile controls from spawning duplicates.
#[tauri::command]
pub fn running_agents(state: State<'_, AgentProcesses>) -> Vec<String> {
    let entries = scan_process_table();
    let mut guard = state.0.lock().unwrap();
    reconcile_managed(&mut guard, &entries);
    let mut profile_keys = discover_local_agents(&entries, &guard, false)
        .into_iter()
        .filter_map(|agent| agent.info.profile_key)
        .collect::<Vec<_>>();
    profile_keys.sort();
    profile_keys.dedup();
    profile_keys
}

// Called from the RunEvent::Exit handler so Quit never orphans an agent.
pub fn kill_agents(state: &AgentProcesses) {
    let entries = scan_process_table_uncached();
    let mut guard = state.0.lock().unwrap();
    reconcile_managed(&mut guard, &entries);
    let discovered = discover_local_agents(&entries, &guard, false);
    let mut targets = Vec::new();
    for (_, mut process) in guard.drain() {
        if let Some(agent) = discovered
            .iter()
            .find(|agent| managed_process_matches_agent(&process, agent))
            .cloned()
        {
            targets.push(StopTarget {
                agent,
                child: process.child.take(),
            });
        }
    }
    drop(guard);
    if !targets.is_empty() {
        stop_targets(targets, EXIT_STOP_TIMEOUT_MS);
    }
    persist_process_registry(&HashMap::new());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_process_identity_and_profile() {
        let entry = parse_ps_line(
            "34649 1 34649 Thu Jul 16 17:35:50 2026 node /repo/apps/cli/bin/convoy.ts connect --json --profile os-local",
        )
        .expect("valid ps row");

        assert_eq!(entry.pid, 34649);
        assert_eq!(entry.parent_pid, 1);
        assert_eq!(entry.process_group_id, 34649);
        assert_eq!(entry.started_at, "Thu Jul 16 17:35:50 2026");
        assert_eq!(entry.profile_key.as_deref(), Some("os-local"));
        assert!(is_convoy_connect(&entry.command));
    }

    #[test]
    fn recognizes_equals_profile_syntax() {
        let command = "node /usr/local/lib/node_modules/@useconvoy/cli/dist/bin/convoy.js connect --profile=os-local";

        assert_eq!(extract_profile_key(command).as_deref(), Some("os-local"));
        assert!(is_convoy_connect(command));
    }

    #[test]
    fn ignores_unrelated_processes_in_a_convoy_checkout() {
        let command = "node /repo/convoy/src/apps/web/node_modules/next/dist/bin/next dev";

        assert!(!is_convoy_connect(command));
    }

    #[test]
    fn groups_wrapper_and_worker_as_one_local_connection() {
        let entries = vec![
            parse_ps_line(
                "34649 1 34649 Thu Jul 16 17:35:50 2026 node /repo/apps/cli/bin/convoy.ts connect --json --profile os-local",
            )
            .unwrap(),
            parse_ps_line(
                "34658 34649 34649 Thu Jul 16 17:35:50 2026 node /repo/apps/cli/bin/convoy.ts connect --json --profile os-local",
            )
            .unwrap(),
        ];

        let agents = discover_local_agents(&entries, &HashMap::new(), false);

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].info.pid, 34649);
        assert_eq!(agents[0].info.process_count, 2);
        assert_eq!(agents[0].info.profile_key.as_deref(), Some("os-local"));
        assert!(agents[0].owns_process_group);
        assert!(!agents[0].info.managed);
    }

    /// Mirrors `read_agent_log`'s tail extraction against a temp file so the
    /// seek/partial-line handling is covered without touching the real log.
    fn tail_of(path: &PathBuf) -> String {
        let mut file = File::open(path).expect("log file");
        let length = file.metadata().expect("metadata").len();
        let start = length.saturating_sub(LOG_TAIL_BYTES);
        file.seek(SeekFrom::Start(start)).expect("seek");
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).expect("read");
        let text = String::from_utf8_lossy(&bytes);
        if start == 0 {
            return text.into_owned();
        }
        match text.find('\n') {
            Some(index) => text[index + 1..].to_string(),
            None => text.into_owned(),
        }
    }

    fn temp_log(name: &str, contents: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("convoy-test-{}-{}.log", name, std::process::id()));
        fs::write(&path, contents).expect("write temp log");
        path
    }

    #[test]
    fn reads_a_short_log_in_full() {
        let path = temp_log("short", b"line one\nline two\n");

        assert_eq!(tail_of(&path), "line one\nline two\n");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn tails_a_large_log_without_reading_it_all() {
        // 32 KiB of numbered lines: well past the 16 KiB tail window.
        let mut contents = String::new();
        for index in 0..4_000 {
            contents.push_str(&format!("line {index}\n"));
        }
        let path = temp_log("large", contents.as_bytes());

        let tail = tail_of(&path);

        assert!(contents.len() as u64 > LOG_TAIL_BYTES);
        assert!(tail.len() as u64 <= LOG_TAIL_BYTES);
        assert!(tail.ends_with("line 3999\n"));
        // The partial first line produced by the mid-file seek is dropped.
        assert!(tail.starts_with("line "));

        let _ = fs::remove_file(path);
    }

    /// Writing a 64 MiB fixture just to see it deleted is not worth the test
    /// runtime, so this pins the side of the cap that matters for every normal
    /// start: a log under the limit is never truncated.
    #[test]
    fn keeps_a_log_under_the_size_cap() {
        let path = temp_log("under-cap", &vec![b'x'; 128]);

        truncate_log_if_oversized(&path);

        assert_eq!(fs::metadata(&path).expect("metadata").len(), 128);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_reused_pid_with_a_different_start_time() {
        let entries = vec![parse_ps_line(
            "34649 1 34649 Fri Jul 24 15:00:00 2026 node /repo/apps/cli/bin/convoy.ts connect --json --profile os-local",
        )
        .unwrap()];
        let record = ManagedProcessRecord {
            profile_key: "os-local".to_string(),
            pid: 34649,
            process_group_id: 34649,
            started_at: "Thu Jul 16 17:35:50 2026".to_string(),
        };

        assert!(!record_matches_process(&record, &entries));
    }
}
