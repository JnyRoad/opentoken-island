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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_default_opentoken_path() {
        let path = opentoken_bin(Path::new(r"C:\Users\ty"));
        assert_eq!(path, PathBuf::from(r"C:\Users\ty\.opentoken\bin\opentoken.exe"));
    }

    #[test]
    fn builds_server_resource_path() {
        let path = server_resource_path(Path::new(r"C:\App\resources"));
        assert_eq!(path, PathBuf::from(r"C:\App\resources\server.js"));
    }

    #[test]
    fn builds_local_urls() {
        assert_eq!(local_url("popover.html"), "http://127.0.0.1:4174/popover.html");
        assert_eq!(local_url("/island.html"), "http://127.0.0.1:4174/island.html");
    }

    #[test]
    fn detects_closed_local_port() {
        assert!(!is_port_open(9));
    }
}
