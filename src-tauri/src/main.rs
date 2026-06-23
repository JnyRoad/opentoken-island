mod windows_support;

use std::{
    env,
    io::{Error as IoError, ErrorKind},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
use windows_support::{
    is_port_open, local_url, opentoken_bin, server_resource_path, DEFAULT_PORT,
};

struct ServerProcess(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            start_server_if_needed(app.handle())?;
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "panel" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build OpenToken Island")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<ServerProcess>() {
                    if let Ok(mut child) = state.0.lock() {
                        if let Some(mut child) = child.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_panel = MenuItem::with_id(app, "open-panel", "Open Panel", true, None::<&str>)?;
    let show_island_item = MenuItem::with_id(app, "show-island", "Show Island", true, None::<&str>)?;
    let open_browser = MenuItem::with_id(app, "open-browser", "Open Browser UI", true, None::<&str>)?;
    let open_logs = MenuItem::with_id(app, "open-logs", "Open Logs", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit OpenToken Island", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_panel,
            &show_island_item,
            &open_browser,
            &open_logs,
            &separator,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("opentoken-island")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("OpenToken Island")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-panel" => {
                let _ = show_panel(app);
            }
            "show-island" => {
                let _ = show_island(app);
            }
            "open-browser" => {
                let _ = open_external(&local_url("popover.html"));
            }
            "open-logs" => {
                let _ = open_logs_file();
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_panel(&tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

fn start_server_if_needed(app: &AppHandle) -> tauri::Result<()> {
    if is_port_open(DEFAULT_PORT) {
        return Ok(());
    }

    let server = resolve_server_path(app);
    let home = user_home();
    let opentoken = opentoken_bin(&home);
    let mut command = Command::new("node");
    command
        .arg(&server)
        .current_dir(server.parent().unwrap_or_else(|| Path::new(".")))
        .env("OPENTOKEN_ISLAND_PORT", DEFAULT_PORT.to_string())
        .env("OPENTOKEN_BIN", opentoken);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let child = command.spawn().map_err(|error| {
        tauri::Error::Io(std::io::Error::new(
            error.kind(),
            format!(
                "failed to start OpenToken Island server at {}: {error}",
                server.display()
            ),
        ))
    })?;

    if let Some(state) = app.try_state::<ServerProcess>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(child);
        }
    }

    Ok(())
}

fn show_panel(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("panel") {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let url = external_url("popover.html")?;
    WebviewWindowBuilder::new(app, "panel", WebviewUrl::External(url))
        .title("OpenToken Island")
        .inner_size(430.0, 700.0)
        .resizable(false)
        .visible(true)
        .build()?;
    Ok(())
}

fn show_island(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.close();
    }

    let url = external_url("island.html")?;
    let window = WebviewWindowBuilder::new(app, "island", WebviewUrl::External(url))
        .title("OpenToken Island")
        .inner_size(560.0, 118.0)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(true)
        .build()?;

    let window_clone = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        let _ = window_clone.close();
    });
    Ok(())
}

fn open_external(target: &str) -> std::io::Result<()> {
    Command::new("cmd")
        .args(["/C", "start", "", target])
        .spawn()
        .map(|_| ())
}

fn external_url(path: &str) -> tauri::Result<Url> {
    Url::parse(&local_url(path)).map_err(|error| {
        tauri::Error::Io(IoError::new(
            ErrorKind::InvalidInput,
            format!("invalid local OpenToken Island URL for {path}: {error}"),
        ))
    })
}

fn open_logs_file() -> std::io::Result<()> {
    let log = user_home().join(".opentoken").join("island-events.log");
    open_external(&log.to_string_lossy())
}

fn resolve_server_path(app: &AppHandle) -> PathBuf {
    let resource_server = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| server_resource_path(&dir))
        .filter(|path| path.exists());
    if let Some(path) = resource_server {
        return path;
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("server.js")
}

fn user_home() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
