mod agents;
mod config;
mod supervisor;

use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;

const CONVOY_WEB_URL: &str = "https://app.convoy.build";

/// "Show Dock icon" toggle (OS-1239): off = tray-only via Accessory policy.
/// The frontend persists the preference and re-applies it on startup.
#[tauri::command]
fn set_dock_icon_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        app.set_activation_policy(policy).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);
    Ok(())
}

/// Escape hatch: open ~/.config/convoy/config.toml in the default editor.
#[tauri::command]
fn open_config_file(app: AppHandle) -> Result<(), String> {
    let path = config::config_path().ok_or("Could not resolve home directory")?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Tray state (OS-1237), driven by the webview's Convex subscription:
/// `title` renders next to the icon ("2" running, "!" needs attention),
/// `tooltip` on hover. Empty string clears.
#[tauri::command]
fn set_tray_status(app: AppHandle, title: String, tooltip: String) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("Tray icon not found")?;
    tray.set_title(if title.is_empty() { None } else { Some(title.as_str()) })
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(if tooltip.is_empty() { None } else { Some(tooltip.as_str()) })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// One entry of the native tray menu (OS-1237). The webview owns the menu
/// content (it has the Convex subscriptions) and rebuilds it on every data
/// change; Rust only translates the model into a real NSMenu.
#[derive(serde::Deserialize)]
struct TrayMenuEntry {
    kind: String, // "item" | "header" | "separator"
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    text: Option<String>,
    /// Gray second line inside the row (NSMenuItem.subtitle, macOS 14.4+).
    #[serde(default)]
    subtext: Option<String>,
}

#[tauri::command]
fn set_tray_menu(app: AppHandle, entries: Vec<TrayMenuEntry>) -> Result<(), String> {
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let subtexts: Vec<Option<String>> = entries.iter().map(|entry| entry.subtext.clone()).collect();
    for entry in entries {
        match entry.kind.as_str() {
            "separator" => {
                let item = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
                menu.append(&item).map_err(|e| e.to_string())?;
            }
            "header" => {
                let text = entry.text.unwrap_or_default();
                let item = MenuItem::new(&app, text, false, None::<&str>).map_err(|e| e.to_string())?;
                menu.append(&item).map_err(|e| e.to_string())?;
            }
            _ => {
                #[cfg(target_os = "macos")]
                let text = entry.text.unwrap_or_default();
                // No subtitle API off macOS — fold the subtext into the label.
                #[cfg(not(target_os = "macos"))]
                let text = match entry.subtext {
                    Some(subtext) => format!("{} — {}", entry.text.unwrap_or_default(), subtext),
                    None => entry.text.unwrap_or_default(),
                };
                let id = entry.id.unwrap_or_else(|| text.clone());
                let item = MenuItem::with_id(&app, id, text, true, None::<&str>).map_err(|e| e.to_string())?;
                menu.append(&item).map_err(|e| e.to_string())?;
            }
        }
    }
    let tray = app.tray_by_id("main").ok_or("Tray icon not found")?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    apply_menu_subtitles(&tray, subtexts);
    Ok(())
}

/// muda has no subtitle API, so reach through the NSStatusItem to the real
/// NSMenu and set NSMenuItem.subtitle per row (entries map 1:1 to menu items).
#[cfg(target_os = "macos")]
fn apply_menu_subtitles(tray: &tauri::tray::TrayIcon, subtexts: Vec<Option<String>>) {
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSObjectProtocol, NSString};
    let _ = tray.with_inner_tray_icon(move |inner| {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(status_item) = inner.ns_status_item() else { return };
        let Some(menu) = status_item.menu(mtm) else { return };
        for (item, subtext) in menu.itemArray().iter().zip(subtexts) {
            let Some(subtext) = subtext else { continue };
            // ponytail: setSubtitle: is macOS 14.4+; older systems just lose the line
            if item.respondsToSelector(objc2::sel!(setSubtitle:)) {
                item.setSubtitle(Some(&NSString::from_str(&subtext)));
            }
        }
    });
}

fn base_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open-web", "Open Convoy", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
        ],
    )
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "open-web" => {
            let _ = app.opener().open_url(CONVOY_WEB_URL, None::<&str>);
        }
        "settings" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "quit" => app.exit(0),
        // Dynamic entries (toggle-agent, thread:<id>) belong to the webview.
        other => {
            let _ = app.emit("tray-menu-action", other);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(supervisor::AgentProcesses::default())
        .invoke_handler(tauri::generate_handler![
            config::load_config,
            config::save_profile,
            config::set_default_profile,
            config::save_provider_key,
            config::delete_provider_key,
            config::set_profile_provider_key,
            agents::detect_agents,
            agents::install_agent,
            supervisor::start_agent,
            supervisor::stop_agent,
            supervisor::running_agents,
            supervisor::list_local_agents,
            supervisor::stop_local_agent,
            supervisor::read_agent_log,
            set_dock_icon_visible,
            open_config_file,
            set_tray_status,
            set_tray_menu,
        ])
        .setup(|app| {
            // Native tray menu (OS-1237): the webview replaces this baseline
            // via set_tray_menu once its Convex subscriptions deliver data.
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&base_tray_menu(app.handle())?)
                .show_menu_on_left_click(true)
                .build(app)?;

            // App menu mirrors the tray so a crowded menu bar never locks you out.
            let app_menu = Submenu::with_items(
                app,
                "Convoy",
                true,
                &[
                    &PredefinedMenuItem::about(
                        app,
                        Some("About Convoy"),
                        Some(AboutMetadata {
                            name: Some("Convoy".into()),
                            ..Default::default()
                        }),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "open-web", "Open Convoy Web", true, None::<&str>)?,
                    &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::quit(app, Some("Quit Convoy"))?,
                ],
            )?;
            // Edit menu keeps native copy/paste working in webview inputs on macOS.
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;
            app.set_menu(Menu::with_items(app, &[&app_menu, &edit_menu])?)?;

            Ok(())
        })
        .on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()))
        .on_window_event(|window, event| {
            // Closing the settings window hides it; the tray keeps the app
            // alive and the hidden webview keeps its Convex subscriptions.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Clicking the Dock icon reopens the settings window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            // Kill every spawned `convoy connect` so Quit never orphans one.
            if let tauri::RunEvent::Exit = event {
                supervisor::kill_agents(&app.state::<supervisor::AgentProcesses>());
            }
        });
}
