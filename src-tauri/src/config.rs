use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const DEFAULT_CLOUD_BASE_URL: &str = "http://127.0.0.1:8082";

fn default_cloud_base_url() -> String {
    DEFAULT_CLOUD_BASE_URL.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopConfig {
    #[serde(default = "default_cloud_base_url")]
    pub cloud_base_url: String,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            cloud_base_url: default_cloud_base_url(),
        }
    }
}

impl DesktopConfig {
    /// Parse TOML text into a config.
    pub fn from_toml(text: &str) -> Result<Self, String> {
        toml::from_str(text).map_err(|err| format!("failed to parse config: {err}"))
    }

    /// Parse TOML text; empty or missing fields fall back via serde defaults when valid.
    pub fn load_from_str(text: &str) -> Result<Self, String> {
        if text.trim().is_empty() {
            return Err("empty config".into());
        }
        Self::from_toml(text)
    }

    /// Load from disk. Search order: `CWD/config.toml`, then `exe_dir/config.toml`.
    /// Missing file → default URL with a stderr hint.
    pub fn load() -> Result<Self, String> {
        let candidates = config_candidates();
        for path in &candidates {
            if path.is_file() {
                return Self::load_from_path(path);
            }
        }
        eprintln!(
            "config.toml not found (searched {:?}); using default cloud_base_url={}",
            candidates
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>(),
            DEFAULT_CLOUD_BASE_URL
        );
        Ok(Self::default())
    }

    fn load_from_path(path: &Path) -> Result<Self, String> {
        let text = fs::read_to_string(path)
            .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
        Self::from_toml(&text)
            .map_err(|err| format!("{}: {err}", path.display()))
    }
}

fn config_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join("config.toml"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("config.toml"));
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_uses_default_url() {
        let cfg = DesktopConfig::load_from_str("").unwrap_or_default();
        assert_eq!(cfg.cloud_base_url, "http://127.0.0.1:8082");
    }

    #[test]
    fn parses_cloud_base_url() {
        let cfg =
            DesktopConfig::from_toml(r#"cloud_base_url = "http://127.0.0.1:9000""#).unwrap();
        assert_eq!(cfg.cloud_base_url, "http://127.0.0.1:9000");
    }

    #[test]
    fn empty_toml_object_uses_default_url() {
        let cfg = DesktopConfig::from_toml("").unwrap();
        assert_eq!(cfg.cloud_base_url, DEFAULT_CLOUD_BASE_URL);
    }
}
