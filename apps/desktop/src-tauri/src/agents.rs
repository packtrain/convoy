use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

pub struct AgentSpec {
    pub kind: &'static str,
    pub bin: &'static str,
    pub version_cmd: &'static str,
    pub install_cmd: &'static str,
}

static AGENT_CATALOG: [AgentSpec; 4] = [
    AgentSpec {
        kind: "claude-code",
        bin: "claude",
        version_cmd: "claude --version",
        install_cmd: "npm install -g @anthropic-ai/claude-code",
    },
    AgentSpec {
        kind: "codex",
        bin: "codex",
        version_cmd: "codex --version",
        install_cmd: "npm install -g @openai/codex",
    },
    AgentSpec {
        kind: "opencode",
        bin: "opencode",
        version_cmd: "opencode --version",
        install_cmd: "curl -fsSL https://opencode.ai/install | bash",
    },
    AgentSpec {
        kind: "cursor",
        bin: "cursor-agent",
        version_cmd: "cursor-agent --version",
        install_cmd: "curl https://cursor.com/install -fsS | bash",
    },
];

// GUI apps on macOS inherit a minimal PATH (no /opt/homebrew/bin, no nvm),
// so every external command runs through the user's login shell to pick up
// their real environment.
pub fn login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

pub fn run_login_shell(cmd: &str) -> std::io::Result<Output> {
    Command::new(login_shell()).arg("-lc").arg(cmd).output()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub kind: String,
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub ok: bool,
    pub error: Option<String>,
}

fn looks_like_version(token: &str) -> bool {
    let t = token.trim_start_matches('v');
    t.chars().next().is_some_and(|c| c.is_ascii_digit()) && t.contains('.')
}

fn parse_version(stdout: &str) -> Option<String> {
    let first_line = stdout.lines().next()?.trim();
    if first_line.is_empty() {
        return None;
    }
    let token = first_line
        .split_whitespace()
        .rev()
        .find(|t| looks_like_version(t))
        .unwrap_or(first_line);
    Some(token.to_string())
}

fn detect_one(spec: &AgentSpec) -> AgentStatus {
    let installed = run_login_shell(&format!("command -v {}", spec.bin))
        .map(|o| o.status.success())
        .unwrap_or(false);
    let version = if installed {
        run_login_shell(spec.version_cmd)
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| parse_version(&String::from_utf8_lossy(&o.stdout)))
    } else {
        None
    };
    AgentStatus {
        kind: spec.kind.to_string(),
        installed,
        version,
    }
}

#[tauri::command]
pub async fn detect_agents() -> Vec<AgentStatus> {
    let handles: Vec<_> = AGENT_CATALOG
        .iter()
        .map(|spec| tauri::async_runtime::spawn_blocking(move || detect_one(spec)))
        .collect();
    let mut statuses = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(status) = handle.await {
            statuses.push(status);
        }
    }
    statuses
}

const INSTALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

fn tail(s: &str, max_bytes: usize) -> String {
    let trimmed = s.trim();
    if trimmed.len() <= max_bytes {
        return trimmed.to_string();
    }
    let mut start = trimmed.len() - max_bytes;
    while !trimmed.is_char_boundary(start) {
        start += 1;
    }
    trimmed[start..].to_string()
}

fn run_install(cmd: &'static str) -> InstallResult {
    let spawned = Command::new(login_shell())
        .arg("-lc")
        .arg(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            return InstallResult {
                ok: false,
                error: Some(e.to_string()),
            }
        }
    };

    // Drain pipes on threads so a chatty installer can't deadlock the wait loop.
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut buf);
        }
        buf
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_string(&mut buf);
        }
        buf
    });

    let deadline = Instant::now() + INSTALL_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return InstallResult {
                        ok: false,
                        error: Some("Timed out".to_string()),
                    };
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => {
                return InstallResult {
                    ok: false,
                    error: Some(e.to_string()),
                }
            }
        }
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    if status.success() {
        return InstallResult {
            ok: true,
            error: None,
        };
    }
    let output = if stderr.trim().is_empty() { stdout } else { stderr };
    InstallResult {
        ok: false,
        error: Some(tail(&output, 500)),
    }
}

#[tauri::command]
pub async fn install_agent(kind: String) -> InstallResult {
    // Only fixed catalog command strings ever reach the shell; caller input
    // just selects a catalog entry and is never interpolated.
    let Some(spec) = AGENT_CATALOG.iter().find(|s| s.kind == kind) else {
        return InstallResult {
            ok: false,
            error: Some(format!("Unknown agent kind: {kind}")),
        };
    };
    let cmd = spec.install_cmd;
    tauri::async_runtime::spawn_blocking(move || run_install(cmd))
        .await
        .unwrap_or(InstallResult {
            ok: false,
            error: Some("Install task failed".to_string()),
        })
}
