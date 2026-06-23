#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod windows_support;

use std::{
    env,
    io::{Error as IoError, ErrorKind},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, Position, Rect, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows_support::{
    floating_window_origin, is_port_open, local_url, opentoken_bin, server_resource_path,
    DEFAULT_PORT,
};

const PANEL_LABEL: &str = "panel";
const ISLAND_LABEL: &str = "island";
const ISLAND_WIDTH: i32 = 560;
const ISLAND_HEIGHT: i32 = 118;
const FLOATING_MARGIN: i32 = 12;

struct ServerProcess(Mutex<Option<Child>>);
struct HoverState(AtomicU64);

fn main() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .manage(HoverState(AtomicU64::new(0)))
        .setup(|app| {
            start_server_if_needed(app.handle())?;
            prewarm_windows(app.handle())?;
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if matches!(window.label(), PANEL_LABEL | ISLAND_LABEL) {
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
    let show_island_item =
        MenuItem::with_id(app, "show-island", "Show Island", true, None::<&str>)?;
    let open_browser =
        MenuItem::with_id(app, "open-browser", "Open Browser UI", true, None::<&str>)?;
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
        .tooltip("OpenToken Island - hover for today's quota")
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
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Enter { position, rect, .. }
                | TrayIconEvent::Move { position, rect, .. } => {
                    let _ = show_hover_island(&app, position, rect);
                }
                TrayIconEvent::Leave { .. } => {
                    schedule_hide_island(&app, Duration::from_millis(900));
                }
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    let _ = hide_island(&app);
                    let _ = show_panel(&app);
                }
                _ => {}
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

    wait_for_server(DEFAULT_PORT, Duration::from_secs(3))?;
    Ok(())
}

fn wait_for_server(port: u16, timeout: Duration) -> tauri::Result<()> {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if is_port_open(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    Err(tauri::Error::Io(IoError::new(
        ErrorKind::TimedOut,
        format!("OpenToken Island server did not become ready on port {port}"),
    )))
}

fn prewarm_windows(app: &AppHandle) -> tauri::Result<()> {
    let _ = ensure_panel_window(app)?;
    let _ = ensure_island_window(app)?;
    Ok(())
}

fn show_panel(app: &AppHandle) -> tauri::Result<()> {
    let window = ensure_panel_window(app)?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn ensure_panel_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        return Ok(window);
    }

    let url = external_url("popover.html")?;
    WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::External(url))
        .title("OpenToken Island")
        .inner_size(430.0, 700.0)
        .resizable(false)
        .visible(false)
        .build()
}

fn show_island(app: &AppHandle) -> tauri::Result<()> {
    let cursor = app
        .cursor_position()
        .unwrap_or_else(|_| PhysicalPosition::new(0.0, 0.0));
    let window = ensure_island_window(app)?;
    let (x, y) = floating_window_origin(
        cursor.x.round() as i32,
        cursor.y.round() as i32,
        32,
        32,
        ISLAND_WIDTH,
        ISLAND_HEIGHT,
        FLOATING_MARGIN,
    );
    bump_hover_epoch(app);
    window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    window.show()?;
    schedule_hide_island(app, Duration::from_secs(5));
    Ok(())
}

fn show_hover_island(
    app: &AppHandle,
    cursor: PhysicalPosition<f64>,
    rect: Rect,
) -> tauri::Result<()> {
    bump_hover_epoch(app);
    let window = ensure_island_window(app)?;
    let position = island_position(cursor, rect);
    window.set_position(Position::Physical(position))?;
    window.show()?;
    Ok(())
}

fn island_position(cursor: PhysicalPosition<f64>, rect: Rect) -> PhysicalPosition<i32> {
    let rect_position = rect.position.to_physical::<i32>(1.0);
    let rect_size = rect.size.to_physical::<u32>(1.0);
    let (tray_x, tray_y, tray_width, tray_height) = if rect_size.width == 0 || rect_size.height == 0
    {
        (cursor.x.round() as i32, cursor.y.round() as i32, 32, 32)
    } else {
        (
            rect_position.x,
            rect_position.y,
            rect_size.width as i32,
            rect_size.height as i32,
        )
    };

    let (x, y) = floating_window_origin(
        tray_x,
        tray_y,
        tray_width,
        tray_height,
        ISLAND_WIDTH,
        ISLAND_HEIGHT,
        FLOATING_MARGIN,
    );
    PhysicalPosition::new(x, y)
}

fn ensure_island_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(ISLAND_LABEL) {
        return Ok(window);
    }

    let url = external_url("island.html")?;
    WebviewWindowBuilder::new(app, ISLAND_LABEL, WebviewUrl::External(url))
        .title("OpenToken Island")
        .inner_size(560.0, 118.0)
        .decorations(false)
        .transparent(true)
        .focusable(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .build()
}

fn schedule_hide_island(app: &AppHandle, delay: Duration) {
    let epoch = bump_hover_epoch(app);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if current_hover_epoch(&app) == epoch {
            let _ = hide_island(&app);
        }
    });
}

fn hide_island(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(ISLAND_LABEL) {
        window.hide()?;
    }
    Ok(())
}

fn bump_hover_epoch(app: &AppHandle) -> u64 {
    app.try_state::<HoverState>()
        .map(|state| state.0.fetch_add(1, Ordering::SeqCst) + 1)
        .unwrap_or(0)
}

fn current_hover_epoch(app: &AppHandle) -> u64 {
    app.try_state::<HoverState>()
        .map(|state| state.0.load(Ordering::SeqCst))
        .unwrap_or(0)
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
