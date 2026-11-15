use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use toml_edit::{value, Array, DocumentMut, Item, Table};

const MIN_PROFILE_CONCURRENCY: i64 = 1;
const MAX_PROFILE_CONCURRENCY: i64 = 50;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    pub key: String,
    pub name: String,
    pub url: String,
    pub api_key: String,
    pub project_id: String,
    pub paths: Vec<String>,
    pub streaming: Option<bool>,
    pub isolated: Option<bool>,
    pub concurrency: Option<i64>,
    pub provider_key: Option<String>,
    /// Codex's own `[keys.*]` assignment (Mantle/Bedrock), independent of `provider_key`.
    pub codex_provider_key: Option<String>,
}

/// A `[keys.<name>]` entry: a local model provider assignable to profiles via
/// `provider_key`. Never leaves this machine. `token` is absent for the
/// credential-free `anthropic` provider, which pins agents to this machine's
/// Claude sign-in.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyInfo {
    pub name: String,
    pub provider: String,
    pub token: Option<String>,
    pub region: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInfo {
    pub profiles: Vec<ProfileInfo>,
    pub default_profile: Option<String>,
    pub keys: Vec<ProviderKeyInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProfileArgs {
    pub name: String,
    pub url: String,
    pub api_key: String,
    pub project_id: String,
    pub paths: Vec<String>,
    pub profile_key: Option<String>,
    pub streaming: Option<bool>,
    pub isolated: Option<bool>,
    pub concurrency: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProfileResult {
    pub key: String,
}

// The Node CLI hardcodes ~/.config/convoy on every platform (no env
// override, no platform config dirs) — see apps/cli/src/lib/constants.ts.
// The desktop app must match exactly so both share the same file.
pub fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".config").join("convoy").join("config.toml"))
}

fn write_document(path: &PathBuf, doc: &DocumentMut) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, doc.to_string()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn read_document(path: &PathBuf) -> Result<DocumentMut, String> {
    if !path.exists() {
        return Ok(DocumentMut::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    content
        .parse::<DocumentMut>()
        .map_err(|e| format!("Invalid config file: {e}"))
}

fn string_field(table: &dyn toml_edit::TableLike, key: &str) -> Option<String> {
    table.get(key)?.as_str().map(|s| s.to_string())
}

fn validate_profile_concurrency(concurrency: i64) -> Result<i64, String> {
    if !(MIN_PROFILE_CONCURRENCY..=MAX_PROFILE_CONCURRENCY).contains(&concurrency) {
        return Err(format!(
            "Concurrency must be an integer from {MIN_PROFILE_CONCURRENCY} to {MAX_PROFILE_CONCURRENCY}"
        ));
    }
    Ok(concurrency)
}

fn profile_concurrency(table: &dyn toml_edit::TableLike) -> Option<i64> {
    table
        .get("concurrency")
        .and_then(|item| item.as_integer())
        .and_then(|concurrency| validate_profile_concurrency(concurrency).ok())
}

fn apply_optional_runtime_settings(
    profile: &mut dyn toml_edit::TableLike,
    streaming: Option<bool>,
    isolated: Option<bool>,
    concurrency: Option<i64>,
) -> Result<(), String> {
    if let Some(streaming) = streaming {
        profile.insert("streaming", value(streaming));
    }
    if let Some(isolated) = isolated {
        profile.insert("isolated", value(isolated));
    }
    if let Some(concurrency) = concurrency {
        profile.insert(
            "concurrency",
            value(validate_profile_concurrency(concurrency)?),
        );
    }
    Ok(())
}

fn profile_from_item(key: &str, item: &Item) -> Option<ProfileInfo> {
    let table = item.as_table_like()?;
    let paths = table
        .get("paths")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();
    Some(ProfileInfo {
        key: key.to_string(),
        name: string_field(table, "name")?,
        url: string_field(table, "url")?,
        api_key: string_field(table, "api_key")?,
        project_id: string_field(table, "project_id")?,
        paths,
        streaming: table.get("streaming").and_then(|v| v.as_bool()),
        isolated: table.get("isolated").and_then(|v| v.as_bool()),
        concurrency: profile_concurrency(table),
        provider_key: string_field(table, "provider_key"),
        codex_provider_key: string_field(table, "codex_provider_key"),
    })
}

fn provider_key_from_item(name: &str, item: &Item) -> Option<ProviderKeyInfo> {
    let table = item.as_table_like()?;
    Some(ProviderKeyInfo {
        name: name.to_string(),
        provider: string_field(table, "provider")?,
        token: string_field(table, "token"),
        region: string_field(table, "region"),
    })
}

#[tauri::command]
pub fn load_config() -> ConfigInfo {
    let empty = ConfigInfo {
        profiles: Vec::new(),
        default_profile: None,
        keys: Vec::new(),
    };
    let Some(path) = config_path() else {
        return empty;
    };
    // Match the CLI: an unreadable/unparseable file behaves like an empty one.
    let Ok(doc) = read_document(&path) else {
        return empty;
    };

    let profiles = doc
        .get("profiles")
        .and_then(Item::as_table_like)
        .map(|table| {
            table
                .iter()
                .filter_map(|(key, item)| profile_from_item(key, item))
                .collect()
        })
        .unwrap_or_default();

    let default_profile = doc
        .get("settings")
        .and_then(Item::as_table_like)
        .and_then(|settings| string_field(settings, "default_profile"));

    let keys = doc
        .get("keys")
        .and_then(Item::as_table_like)
        .map(|table| {
            table
                .iter()
                .filter_map(|(name, item)| provider_key_from_item(name, item))
                .collect()
        })
        .unwrap_or_default();

    ConfigInfo {
        profiles,
        default_profile,
        keys,
    }
}

// Matches the CLI profile key pattern ^[a-z][a-z0-9_-]*$.
fn slugify(name: &str) -> String {
    let mut out = String::new();
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    let key = match trimmed.chars().next() {
        None => return "default".to_string(),
        Some(c) if !c.is_ascii_lowercase() => format!("p{trimmed}"),
        Some(_) => trimmed.to_string(),
    };
    key
}

fn existing_project_id(doc: &DocumentMut, key: &str) -> Option<Option<String>> {
    let table = doc.get("profiles")?.as_table_like()?;
    let profile = table.get(key)?.as_table_like()?;
    Some(string_field(profile, "project_id"))
}

#[tauri::command]
pub fn save_profile(args: SaveProfileArgs) -> Result<SaveProfileResult, String> {
    let path = config_path().ok_or("Could not resolve home directory")?;
    // Read-modify-write: a parse failure must not clobber the user's file.
    let mut doc = read_document(&path)?;

    let base_key = match args.profile_key.as_deref() {
        Some(k) if !k.is_empty() => k.to_string(),
        _ => slugify(&args.name),
    };

    // Same project_id → overwrite (re-onboarding); different → append -2, -3, …
    let mut key = base_key.clone();
    let mut suffix = 2;
    while let Some(project_id) = existing_project_id(&doc, &key) {
        if project_id.as_deref() == Some(args.project_id.as_str()) {
            break;
        }
        key = format!("{base_key}-{suffix}");
        suffix += 1;
    }

    let mut paths = Array::new();
    for p in &args.paths {
        paths.push(p.as_str());
    }

    let profiles = doc.entry("profiles").or_insert(Item::Table({
        let mut t = Table::new();
        t.set_implicit(true); // render [profiles.<key>] without a bare [profiles] header
        t
    }));
    let profiles = profiles
        .as_table_mut()
        .ok_or("Config `profiles` section is not a table")?;

    // Edit in place when the profile exists: preserves comments and any keys
    // this app doesn't know about (the CLI owns the schema).
    if let Some(existing) = profiles.get_mut(&key).and_then(Item::as_table_like_mut) {
        existing.insert("name", value(&args.name));
        existing.insert("url", value(&args.url));
        existing.insert("api_key", value(&args.api_key));
        existing.insert("project_id", value(&args.project_id));
        existing.insert("paths", value(paths));
        apply_optional_runtime_settings(
            existing,
            args.streaming,
            args.isolated,
            args.concurrency,
        )?;
    } else {
        let mut profile = Table::new();
        profile["name"] = value(&args.name);
        profile["url"] = value(&args.url);
        profile["api_key"] = value(&args.api_key);
        profile["project_id"] = value(&args.project_id);
        profile["paths"] = value(paths);
        apply_optional_runtime_settings(
            &mut profile,
            args.streaming,
            args.isolated,
            args.concurrency,
        )?;
        profiles.insert(&key, Item::Table(profile));
    }

    let has_default = doc
        .get("settings")
        .and_then(Item::as_table_like)
        .and_then(|settings| string_field(settings, "default_profile"))
        .is_some();
    if !has_default {
        doc["settings"]["default_profile"] = value(&key);
    }

    write_document(&path, &doc)?;

    Ok(SaveProfileResult { key })
}

/// Create or overwrite a `[keys.<name>]` provider key.
#[tauri::command]
pub fn save_provider_key(
    name: String,
    provider: String,
    token: String,
    region: Option<String>,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Key name cannot be empty".to_string());
    }
    if provider != "bedrock" && provider != "mantle" && provider != "anthropic" {
        return Err(format!("Unknown provider: {provider}"));
    }
    // `anthropic` carries no credential — it pins agents to this machine's
    // Claude sign-in, so token/region are never stored for it.
    let credential_free = provider == "anthropic";
    if !credential_free && token.trim().is_empty() {
        return Err("Token cannot be empty".to_string());
    }

    let path = config_path().ok_or("Could not resolve home directory")?;
    let mut doc = read_document(&path)?;

    // Same guard as the CLI: an edit must not break a Codex assignment.
    if !profiles_using_key_for_codex(&doc, name.trim()).is_empty() {
        let region = region.as_deref().map(str::trim).unwrap_or_default();
        if let Some(issue) = codex_key_issue(name.trim(), &provider, region) {
            return Err(format!("{issue} Unassign it from Codex first."));
        }
    }

    let keys = doc.entry("keys").or_insert(Item::Table({
        let mut t = Table::new();
        t.set_implicit(true);
        t
    }));
    let keys = keys
        .as_table_mut()
        .ok_or("Config `keys` section is not a table")?;

    let mut entry = Table::new();
    entry["provider"] = value(&provider);
    if !credential_free {
        entry["token"] = value(token.trim());
        if let Some(region) = region.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
            entry["region"] = value(region);
        }
    }
    keys.insert(name.trim(), Item::Table(entry));

    write_document(&path, &doc)
}

fn profiles_with_field(doc: &DocumentMut, field: &str, name: &str) -> Vec<String> {
    doc.get("profiles")
        .and_then(Item::as_table_like)
        .map(|table| {
            table
                .iter()
                .filter(|(_, item)| {
                    item.as_table_like()
                        .and_then(|profile| string_field(profile, field))
                        .is_some_and(|key| key == name)
                })
                .map(|(key, _)| key.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn profiles_using_key_for_codex(doc: &DocumentMut, name: &str) -> Vec<String> {
    profiles_with_field(doc, "codex_provider_key", name)
}

/// Profiles referencing a key from either runtime; Codex users are labeled.
fn profiles_using_key(doc: &DocumentMut, name: &str) -> Vec<String> {
    let mut used_by = profiles_with_field(doc, "provider_key", name);
    used_by.extend(
        profiles_using_key_for_codex(doc, name)
            .into_iter()
            .map(|key| format!("{key} (Codex)")),
    );
    used_by
}

/// Why a key cannot serve Codex: only AWS keys, and bearer auth needs a Region (OS-2105).
fn codex_key_issue(name: &str, provider: &str, region: &str) -> Option<String> {
    if provider != "mantle" && provider != "bedrock" {
        return Some(format!("Key \"{name}\" cannot be used by Codex: it needs a Mantle or Bedrock key."));
    }
    if region.trim().is_empty() {
        return Some(format!("Key \"{name}\" cannot be used by Codex: it needs an AWS region."));
    }
    None
}

/// Delete a provider key; refuses while any profile still references it.
#[tauri::command]
pub fn delete_provider_key(name: String) -> Result<(), String> {
    let path = config_path().ok_or("Could not resolve home directory")?;
    let mut doc = read_document(&path)?;

    let used_by = profiles_using_key(&doc, &name);
    if !used_by.is_empty() {
        return Err(format!(
            "Key \"{name}\" is used by profile(s): {}. Unassign it first.",
            used_by.join(", ")
        ));
    }

    let removed = doc
        .get_mut("keys")
        .and_then(Item::as_table_like_mut)
        .and_then(|keys| keys.remove(&name))
        .is_some();
    if !removed {
        return Err(format!("Unknown key: {name}"));
    }

    write_document(&path, &doc)
}

/// Assign a provider key to a profile's runtime (`claude-code` when `runtime`
/// is absent, or `codex`), or clear it with `key_name: None`.
#[tauri::command]
pub fn set_profile_provider_key(
    profile_key: String,
    key_name: Option<String>,
    runtime: Option<String>,
) -> Result<(), String> {
    let codex = match runtime.as_deref() {
        None | Some("claude-code") => false,
        Some("codex") => true,
        Some(other) => return Err(format!("Unknown runtime: {other}")),
    };
    let field = if codex { "codex_provider_key" } else { "provider_key" };
    let path = config_path().ok_or("Could not resolve home directory")?;
    let mut doc = read_document(&path)?;

    if let Some(name) = key_name.as_deref() {
        let key = doc
            .get("keys")
            .and_then(Item::as_table_like)
            .and_then(|keys| keys.get(name))
            .and_then(Item::as_table_like)
            .ok_or(format!("Unknown key: {name}"))?;
        if codex {
            let provider = string_field(key, "provider").unwrap_or_default();
            let region = string_field(key, "region").unwrap_or_default();
            if let Some(issue) = codex_key_issue(name, &provider, &region) {
                return Err(issue);
            }
        }
    }

    let profile = doc
        .get_mut("profiles")
        .and_then(Item::as_table_like_mut)
        .and_then(|table| table.get_mut(&profile_key))
        .and_then(Item::as_table_like_mut)
        .ok_or(format!("Unknown profile: {profile_key}"))?;
    if codex && profile.get("project_isolation").is_some() {
        return Err("Isolated project profiles manage Codex credentials with convoy keys.".to_string());
    }

    match key_name {
        Some(name) => {
            profile.insert(field, value(name));
        }
        None => {
            profile.remove(field);
        }
    }

    write_document(&path, &doc)
}

#[tauri::command]
pub fn set_default_profile(key: String) -> Result<(), String> {
    let path = config_path().ok_or("Could not resolve home directory")?;
    let mut doc = read_document(&path)?;

    let exists = doc
        .get("profiles")
        .and_then(Item::as_table_like)
        .is_some_and(|table| table.get(&key).is_some());
    if !exists {
        return Err(format!("Unknown profile: {key}"));
    }

    doc["settings"]["default_profile"] = value(&key);
    write_document(&path, &doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_both_runtimes_when_a_key_is_in_use() {
        let doc: DocumentMut = "[profiles.a]\nprovider_key = \"k\"\n[profiles.b]\ncodex_provider_key = \"k\"\n"
            .parse()
            .expect("valid TOML");
        assert_eq!(profiles_using_key(&doc, "k"), vec!["a".to_string(), "b (Codex)".to_string()]);
        assert!(profiles_using_key(&doc, "other").is_empty());
    }

    #[test]
    fn accepts_only_aws_keys_with_a_region_for_codex() {
        assert_eq!(codex_key_issue("k", "mantle", "us-east-1"), None);
        assert_eq!(codex_key_issue("k", "bedrock", "us-west-2"), None);
        assert!(codex_key_issue("k", "anthropic", "").is_some());
        assert!(codex_key_issue("k", "mantle", " ").is_some());
    }

    #[test]
    fn validates_profile_concurrency_bounds() {
        assert_eq!(validate_profile_concurrency(1), Ok(1));
        assert_eq!(validate_profile_concurrency(50), Ok(50));
        assert!(validate_profile_concurrency(0).is_err());
        assert!(validate_profile_concurrency(51).is_err());
    }

    #[test]
    fn reads_only_valid_profile_concurrency() {
        let valid: DocumentMut = "[profiles.local]\nconcurrency = 8\n"
            .parse()
            .expect("valid TOML");
        let valid_profile = valid["profiles"]["local"]
            .as_table_like()
            .expect("profile table");
        assert_eq!(profile_concurrency(valid_profile), Some(8));

        let invalid: DocumentMut = "[profiles.local]\nconcurrency = 0\n"
            .parse()
            .expect("valid TOML");
        let invalid_profile = invalid["profiles"]["local"]
            .as_table_like()
            .expect("profile table");
        assert_eq!(profile_concurrency(invalid_profile), None);
    }

    #[test]
    fn updates_concurrency_without_removing_unknown_fields_or_comments() {
        let mut doc: DocumentMut =
            "[profiles.local]\n# keep this comment\nunknown = \"keep\"\nconcurrency = 5\n"
                .parse()
                .expect("valid TOML");
        let profile = doc["profiles"]["local"]
            .as_table_like_mut()
            .expect("profile table");

        apply_optional_runtime_settings(profile, None, None, Some(9))
            .expect("valid concurrency");

        assert_eq!(
            doc["profiles"]["local"]["concurrency"].as_integer(),
            Some(9)
        );
        assert_eq!(
            doc["profiles"]["local"]["unknown"].as_str(),
            Some("keep")
        );
        assert!(doc.to_string().contains("# keep this comment"));
    }
}
