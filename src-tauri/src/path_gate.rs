// =================================================================
// Write-path gate — only dialog-approved paths may be written
// =================================================================
// XSS in the webview must not be able to overwrite arbitrary files via
// write_text_file / write_binary_file. Paths become writable only after
// pick_save_path (native save dialog) records them, and each approval
// is single-use with a short TTL.
// =================================================================

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const APPROVAL_TTL: Duration = Duration::from_secs(120);

pub struct WritePathGate {
    approved: Mutex<HashMap<String, Instant>>,
}

impl WritePathGate {
    pub fn new() -> Self {
        Self {
            approved: Mutex::new(HashMap::new()),
        }
    }

    pub fn approve(&self, path: &str) {
        let key = normalize_path_key(path);
        if key.is_empty() {
            return;
        }
        if let Ok(mut map) = self.approved.lock() {
            sweep(&mut map);
            map.insert(key, Instant::now() + APPROVAL_TTL);
        }
    }

    /// Consume a one-time approval. Returns true if the path was approved.
    pub fn consume(&self, path: &str) -> bool {
        let key = normalize_path_key(path);
        if key.is_empty() {
            return false;
        }
        let Ok(mut map) = self.approved.lock() else {
            return false;
        };
        sweep(&mut map);
        matches!(map.remove(&key), Some(until) if Instant::now() <= until)
    }
}

fn sweep(map: &mut HashMap<String, Instant>) {
    let now = Instant::now();
    map.retain(|_, until| *until > now);
}

pub struct MountedFolder {
    path: Mutex<Option<String>>,
}

impl MountedFolder {
    pub fn new() -> Self {
        Self {
            path: Mutex::new(None),
        }
    }

    pub fn set(&self, folder: &str) {
        let key = normalize_path_key(folder);
        if let Ok(mut g) = self.path.lock() {
            *g = if key.is_empty() { None } else { Some(key) };
        }
    }

    pub fn matches(&self, folder: &str) -> bool {
        let want = normalize_path_key(folder);
        let Ok(g) = self.path.lock() else {
            return false;
        };
        match g.as_ref() {
            Some(mounted) => paths_same(mounted, &want),
            None => false,
        }
    }
}

pub fn normalize_path_key(s: &str) -> String {
    let s = s.trim();
    let s = if s.starts_with("file:///") {
        s.replacen("file:///", "", 1)
    } else if s.starts_with("file://") {
        s.replacen("file://", "", 1)
    } else {
        s.to_string()
    };
    // Collapse trailing slashes for comparison (except root).
    let trimmed = s.trim_end_matches('/');
    if trimmed.is_empty() {
        s
    } else {
        trimmed.to_string()
    }
}

fn paths_same(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let pa = Path::new(a);
    let pb = Path::new(b);
    match (pa.canonicalize(), pb.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

/// Pick a non-colliding path under `dir` for `filename` (already sanitized, with .csv).
pub fn unique_csv_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = filename
        .strip_suffix(".csv")
        .or_else(|| filename.strip_suffix(".CSV"))
        .unwrap_or(filename);
    let mut i = 1u32;
    loop {
        let name = format!("{}-{}.csv", stem, i);
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
        i = i.saturating_add(1);
        if i > 10_000 {
            return dir.join(format!("{}-{}.csv", stem, std::process::id()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn approve_then_consume_once() {
        let gate = WritePathGate::new();
        gate.approve("/tmp/loom-out.html");
        assert!(gate.consume("/tmp/loom-out.html"));
        assert!(!gate.consume("/tmp/loom-out.html"));
    }

    #[test]
    fn reject_unapproved() {
        let gate = WritePathGate::new();
        assert!(!gate.consume("/tmp/evil.sh"));
    }

    #[test]
    fn mounted_folder_match() {
        let m = MountedFolder::new();
        assert!(!m.matches("/data"));
        m.set("/data/loom");
        assert!(m.matches("/data/loom"));
        assert!(m.matches("/data/loom/"));
        assert!(!m.matches("/data/other"));
    }

    #[test]
    fn unique_csv_suffixes() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("loom-unique-csv-{}", stamp));
        fs::create_dir_all(&dir).unwrap();
        let a = unique_csv_path(&dir, "data.csv");
        fs::write(&a, b"a").unwrap();
        let b = unique_csv_path(&dir, "data.csv");
        assert_ne!(a, b);
        assert!(b.file_name().unwrap().to_string_lossy().contains("data-1"));
        let _ = fs::remove_dir_all(&dir);
    }
}
