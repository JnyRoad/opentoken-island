#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod windows_support;

use std::{
    env,
    fs::OpenOptions,
    io::{Error as IoError, ErrorKind, Write},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, Position, Rect, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows_support::{
    floating_window_origin_bounded_with_anchor_gap, is_island_server_ready, is_port_open,
    local_url, opentoken_bin, server_resource_path, DEFAULT_PORT,
};

const PANEL_LABEL: &str = "panel";
const ISLAND_LABEL: &str = "island";
const PANEL_WIDTH: i32 = 430;
const PANEL_HEIGHT: i32 = 700;
const PANEL_SHADOW_PAD: i32 = 18;
const PANEL_WINDOW_WIDTH: i32 = PANEL_WIDTH + PANEL_SHADOW_PAD * 2;
const PANEL_WINDOW_HEIGHT: i32 = PANEL_HEIGHT + PANEL_SHADOW_PAD * 2;
const ISLAND_WIDTH: i32 = 576;
const ISLAND_HEIGHT: i32 = 134;
const FLOATING_MARGIN: i32 = 12;
const PANEL_ANCHOR_GAP: i32 = 430;

struct ServerProcess(Mutex<Option<Child>>);
struct PanelState {
    epoch: AtomicU64,
    pinned: AtomicBool,
}

impl PanelState {
    fn new() -> Self {
        Self {
            epoch: AtomicU64::new(0),
            pinned: AtomicBool::new(false),
        }
    }
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn log_desktop_event(event: &str) {
    let directory = user_home().join(".opentoken");
    let _ = std::fs::create_dir_all(&directory);
    let log_path = directory.join("island-events.log");
    let at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(
            file,
            "{{\"atMs\":{},\"layer\":\"tauri\",\"event\":\"{}\",\"flow\":\"{}\",\"details\":{{}}}}",
            at_ms,
            escape_json(event),
            escape_json(event)
        );
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .manage(PanelState::new())
        .setup(|app| {
            start_server_if_needed(app.handle())?;
            prewarm_windows(app.handle())?;
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == PANEL_LABEL {
                    set_panel_pinned(&window.app_handle(), false);
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == ISLAND_LABEL {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            tauri::WindowEvent::Focused(false) if window.label() == PANEL_LABEL => {
                let _ = hide_pinned_panel_on_blur(&window.app_handle());
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("failed to build OpenToken Island")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                stop_server_process(app);
            }
        });
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_panel = MenuItem::with_id(app, "open-panel", "打开", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "刷新", true, None::<&str>)?;
    let open_browser = MenuItem::with_id(app, "open-browser", "网页", true, None::<&str>)?;
    let restart_server_item =
        MenuItem::with_id(app, "restart-server", "重启服务", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_panel,
            &refresh,
            &open_browser,
            &restart_server_item,
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
                log_desktop_event("tauri.menu.openPanel.click");
                let _ = show_panel(app);
            }
            "refresh" => {
                log_desktop_event("tauri.menu.refresh.click");
                let _ = refresh_panel(app);
            }
            "open-browser" => {
                log_desktop_event("tauri.menu.openBrowser.click");
                let _ = open_external(&local_url("popover.html"));
            }
            "restart-server" => {
                log_desktop_event("tauri.menu.restartServer.click");
                let _ = restart_server(app);
            }
            "quit" => {
                log_desktop_event("tauri.menu.quit.click");
                stop_server_process(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Enter { position, rect, .. } => {
                    log_desktop_event("tauri.tray.hoverEnter");
                    let _ = show_hover_panel(&app, position, rect);
                }
                TrayIconEvent::Move { position, rect, .. } => {
                    let _ = show_hover_panel(&app, position, rect);
                }
                TrayIconEvent::Leave { .. } => {
                    log_desktop_event("tauri.tray.leave");
                    schedule_hide_panel(&app, Duration::from_millis(250));
                }
                TrayIconEvent::Click {
                    position,
                    rect,
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    log_desktop_event("tauri.tray.leftClick");
                    let _ = hide_island(&app);
                    let _ = pin_panel(&app, position, rect);
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
    if is_island_server_ready(DEFAULT_PORT) {
        log_desktop_event("tauri.server.alreadyReady");
        return Ok(());
    }
    if is_port_open(DEFAULT_PORT) {
        log_desktop_event("tauri.server.portInUse");
        return Err(tauri::Error::Io(IoError::new(
            ErrorKind::AddrInUse,
            format!("port {DEFAULT_PORT} is already used by another local service"),
        )));
    }

    let server = resolve_server_path(app);
    log_desktop_event("tauri.server.start");
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
        log_desktop_event("tauri.server.startFailed");
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
    log_desktop_event("tauri.server.ready");
    Ok(())
}

fn stop_server_process(app: &AppHandle) {
    if let Some(state) = app.try_state::<ServerProcess>() {
        if let Ok(mut slot) = state.0.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn restart_server(app: &AppHandle) -> tauri::Result<()> {
    stop_server_process(app);
    start_server_if_needed(app)
}

fn wait_for_server(port: u16, timeout: Duration) -> tauri::Result<()> {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if is_island_server_ready(port) {
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
    let cursor = app
        .cursor_position()
        .unwrap_or_else(|_| PhysicalPosition::new(0.0, 0.0));
    pin_panel(app, cursor, Rect::default())
}

fn refresh_panel(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        window.eval("window.OpenTokenIslandRefresh && window.OpenTokenIslandRefresh()")?;
    }
    Ok(())
}

fn pin_panel(app: &AppHandle, cursor: PhysicalPosition<f64>, rect: Rect) -> tauri::Result<()> {
    log_desktop_event("tauri.panel.pin");
    set_panel_pinned(app, true);
    bump_panel_epoch(app);
    let window = ensure_panel_window(app)?;
    let position = floating_position(
        app,
        cursor,
        rect,
        PANEL_WINDOW_WIDTH,
        PANEL_WINDOW_HEIGHT,
        FLOATING_MARGIN,
        PANEL_ANCHOR_GAP,
    );
    window.set_focusable(true)?;
    window.set_position(Position::Physical(position))?;
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
        .inner_size(PANEL_WINDOW_WIDTH as f64, PANEL_WINDOW_HEIGHT as f64)
        .decorations(false)
        .transparent(true)
        .focusable(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .build()
}

fn show_hover_panel(
    app: &AppHandle,
    cursor: PhysicalPosition<f64>,
    rect: Rect,
) -> tauri::Result<()> {
    if is_panel_pinned(app) {
        return Ok(());
    }

    let epoch = bump_panel_epoch(app);
    let window = ensure_panel_window(app)?;
    let position = floating_position(
        app,
        cursor,
        rect,
        PANEL_WINDOW_WIDTH,
        PANEL_WINDOW_HEIGHT,
        FLOATING_MARGIN,
        PANEL_ANCHOR_GAP,
    );
    window.set_focusable(false)?;
    window.set_position(Position::Physical(position))?;
    window.show()?;
    schedule_hide_panel_at_epoch(app, Duration::from_secs(3), epoch);
    Ok(())
}

fn floating_position(
    app: &AppHandle,
    cursor: PhysicalPosition<f64>,
    rect: Rect,
    window_width: i32,
    window_height: i32,
    edge_margin: i32,
    anchor_gap: i32,
) -> PhysicalPosition<i32> {
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

    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    let (x, y) = if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        floating_window_origin_bounded_with_anchor_gap(
            tray_x,
            tray_y,
            tray_width,
            tray_height,
            window_width,
            window_height,
            edge_margin,
            anchor_gap,
            work_area.position.x,
            work_area.position.y,
            work_area.size.width as i32,
            work_area.size.height as i32,
        )
    } else {
        floating_window_origin_bounded_with_anchor_gap(
            tray_x,
            tray_y,
            tray_width,
            tray_height,
            window_width,
            window_height,
            edge_margin,
            anchor_gap,
            0,
            0,
            window_width + edge_margin * 2,
            window_height + edge_margin * 2,
        )
    };
    PhysicalPosition::new(x, y)
}

fn ensure_island_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(ISLAND_LABEL) {
        return Ok(window);
    }

    let url = external_url("island.html")?;
    WebviewWindowBuilder::new(app, ISLAND_LABEL, WebviewUrl::External(url))
        .title("OpenToken Island")
        .inner_size(ISLAND_WIDTH as f64, ISLAND_HEIGHT as f64)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .focusable(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .build()
}

fn schedule_hide_panel(app: &AppHandle, delay: Duration) {
    let epoch = bump_panel_epoch(app);
    schedule_hide_panel_at_epoch(app, delay, epoch);
}

fn schedule_hide_panel_at_epoch(app: &AppHandle, delay: Duration, epoch: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if current_panel_epoch(&app) == epoch && !is_panel_pinned(&app) {
            let app_for_main = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = hide_panel(&app_for_main);
            });
        }
    });
}

fn hide_panel(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        log_desktop_event("tauri.panel.hide");
        window.hide()?;
    }
    Ok(())
}

fn hide_pinned_panel_on_blur(app: &AppHandle) -> tauri::Result<()> {
    if is_panel_pinned(app) {
        set_panel_pinned(app, false);
        bump_panel_epoch(app);
        hide_panel(app)?;
    }
    Ok(())
}

fn hide_island(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(ISLAND_LABEL) {
        log_desktop_event("tauri.island.hide");
        window.hide()?;
    }
    Ok(())
}

fn set_panel_pinned(app: &AppHandle, pinned: bool) {
    if let Some(state) = app.try_state::<PanelState>() {
        state.pinned.store(pinned, Ordering::SeqCst);
        state.epoch.fetch_add(1, Ordering::SeqCst);
    }
}

fn is_panel_pinned(app: &AppHandle) -> bool {
    app.try_state::<PanelState>()
        .map(|state| state.pinned.load(Ordering::SeqCst))
        .unwrap_or(false)
}

fn bump_panel_epoch(app: &AppHandle) -> u64 {
    app.try_state::<PanelState>()
        .map(|state| state.epoch.fetch_add(1, Ordering::SeqCst) + 1)
        .unwrap_or(0)
}

fn current_panel_epoch(app: &AppHandle) -> u64 {
    app.try_state::<PanelState>()
        .map(|state| state.epoch.load(Ordering::SeqCst))
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
