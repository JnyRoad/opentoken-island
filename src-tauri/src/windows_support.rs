use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const DEFAULT_PORT: u16 = 4174;

pub fn opentoken_bin(home: &Path) -> PathBuf {
    home.join(".opentoken").join("bin").join("opentoken.exe")
}

pub fn server_resource_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("server.js")
}

pub fn local_url(path: &str) -> String {
    let clean = path.trim_start_matches('/');
    format!("http://127.0.0.1:{DEFAULT_PORT}/{clean}")
}

pub fn is_port_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

pub fn is_island_server_ready(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    response.starts_with("HTTP/1.1 200")
        && response.contains("\"ok\":true")
        && response.contains("\"name\":\"opentoken-island\"")
}

#[cfg(test)]
pub fn floating_window_origin(
    tray_x: i32,
    tray_y: i32,
    tray_width: i32,
    tray_height: i32,
    window_width: i32,
    window_height: i32,
    margin: i32,
) -> (i32, i32) {
    let x = (tray_x + tray_width / 2 - window_width / 2).max(margin);
    let y = if tray_y > window_height + margin {
        tray_y - window_height - margin
    } else {
        tray_y + tray_height + margin
    };

    (x, y.max(margin))
}

#[cfg(test)]
pub fn floating_window_origin_bounded(
    tray_x: i32,
    tray_y: i32,
    tray_width: i32,
    tray_height: i32,
    window_width: i32,
    window_height: i32,
    margin: i32,
    work_x: i32,
    work_y: i32,
    work_width: i32,
    work_height: i32,
) -> (i32, i32) {
    floating_window_origin_bounded_with_anchor_gap(
        tray_x,
        tray_y,
        tray_width,
        tray_height,
        window_width,
        window_height,
        margin,
        margin,
        work_x,
        work_y,
        work_width,
        work_height,
    )
}

pub fn floating_window_origin_bounded_with_anchor_gap(
    tray_x: i32,
    tray_y: i32,
    tray_width: i32,
    tray_height: i32,
    window_width: i32,
    window_height: i32,
    edge_margin: i32,
    anchor_gap: i32,
    work_x: i32,
    work_y: i32,
    work_width: i32,
    work_height: i32,
) -> (i32, i32) {
    let x = tray_x + tray_width / 2 - window_width / 2;
    let tray_center_y = tray_y + tray_height / 2;
    let work_center_y = work_y + work_height / 2;
    let y = if tray_center_y >= work_center_y {
        tray_y - window_height - anchor_gap
    } else {
        tray_y + tray_height + anchor_gap
    };

    let min_x = work_x + edge_margin;
    let min_y = work_y + edge_margin;
    let max_x = work_x + work_width - window_width - edge_margin;
    let max_y = work_y + work_height - window_height - edge_margin;

    let x = if max_x >= min_x {
        x.clamp(min_x, max_x)
    } else {
        min_x
    };
    let y = if max_y >= min_y {
        y.clamp(min_y, max_y)
    } else {
        min_y
    };

    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn builds_default_opentoken_path() {
        let path = opentoken_bin(Path::new(r"C:\Users\ty"));
        assert_eq!(
            path,
            Path::new(r"C:\Users\ty")
                .join(".opentoken")
                .join("bin")
                .join("opentoken.exe")
        );
    }

    #[test]
    fn builds_server_resource_path() {
        let path = server_resource_path(Path::new(r"C:\App\resources"));
        assert_eq!(path, Path::new(r"C:\App\resources").join("server.js"));
    }

    #[test]
    fn builds_local_urls() {
        assert_eq!(
            local_url("popover.html"),
            "http://127.0.0.1:4174/popover.html"
        );
        assert_eq!(
            local_url("/island.html"),
            "http://127.0.0.1:4174/island.html"
        );
    }

    #[test]
    fn detects_closed_local_port() {
        assert!(!is_port_open(9));
    }

    #[test]
    fn verifies_island_health_endpoint_instead_of_plain_open_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake local server");
        let port = listener.local_addr().expect("local addr").port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0; 256];
            let _ = stream.read(&mut buffer);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 2\r\n\r\nok",
                )
                .expect("write fake response");
        });

        assert!(is_port_open(port));
        assert!(!is_island_server_ready(port));
        handle.join().expect("fake server thread");
    }

    #[test]
    fn accepts_lightweight_island_health_response() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake local server");
        let port = listener.local_addr().expect("local addr").port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0; 512];
            let size = stream.read(&mut buffer).expect("read request");
            let request = String::from_utf8_lossy(&buffer[..size]);
            assert!(request.starts_with("GET /api/health HTTP/1.1"));
            let body = "{\"ok\":true,\"name\":\"opentoken-island\"}";
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write health response");
        });

        assert!(is_island_server_ready(port));
        handle.join().expect("fake server thread");
    }

    #[test]
    fn positions_floating_window_above_bottom_taskbar_icon() {
        let origin = floating_window_origin(1780, 1032, 32, 32, 560, 118, 12);
        assert_eq!(origin, (1516, 902));
    }

    #[test]
    fn positions_floating_window_below_top_taskbar_icon() {
        let origin = floating_window_origin(420, 0, 32, 32, 560, 118, 12);
        assert_eq!(origin, (156, 44));
    }

    #[test]
    fn clamps_floating_window_to_left_edge() {
        let origin = floating_window_origin(8, 1032, 32, 32, 560, 118, 12);
        assert_eq!(origin.0, 12);
    }

    #[test]
    fn positions_detail_panel_above_bottom_taskbar_icon() {
        let origin = floating_window_origin(1780, 1032, 32, 32, 430, 700, 12);
        assert_eq!(origin, (1581, 320));
    }

    #[test]
    fn clamps_detail_panel_inside_right_edge() {
        let origin =
            floating_window_origin_bounded(1888, 1000, 32, 32, 466, 736, 18, 0, 0, 1920, 1040);
        assert_eq!(origin.0 + 466, 1902);
    }

    #[test]
    fn clamps_detail_panel_inside_bottom_edge_when_below_icon() {
        let origin = floating_window_origin_bounded(24, 24, 32, 32, 466, 736, 18, 0, 0, 1920, 1040);
        assert_eq!(origin.1, 74);
        assert!(origin.1 + 736 <= 1040 - 18);
    }

    #[test]
    fn lifts_detail_panel_to_top_edge_when_hidden_icons_need_more_clearance() {
        let origin = floating_window_origin_bounded_with_anchor_gap(
            1600, 1019, 32, 32, 466, 736, 12, 430, 0, 0, 1707, 1019,
        );
        assert_eq!(origin.1, 12);
        assert_eq!(origin.1 + 736, 748);
        assert_eq!(origin.0 + 466, 1695);
    }
}
