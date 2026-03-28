use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettings {
    pub theme: String,
    pub default_zoom: f64,
}

impl Default for DisplaySettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            default_zoom: 1.0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub dashboard: Option<serde_json::Value>,
    pub search_presets: Option<serde_json::Value>,
    pub selected_portfolio_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub recent_db_paths: Vec<String>,
    pub display: DisplaySettings,
    #[serde(default)]
    pub project_settings: HashMap<String, ProjectSettings>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            recent_db_paths: vec![],
            display: DisplaySettings::default(),
            project_settings: HashMap::new(),
        }
    }
}

pub fn get_settings_path(app_handle: &AppHandle) -> PathBuf {
    let config_dir = app_handle.path().app_config_dir().expect("Failed to get config dir");
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).expect("Failed to create config dir");
    }
    config_dir.join("settings.json")
}

pub fn load_settings(app_handle: &AppHandle) -> AppSettings {
    let path = get_settings_path(app_handle);
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(settings) = serde_json::from_str(&content) {
                return settings;
            }
        }
    }
    AppSettings::default()
}

pub fn save_settings(app_handle: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path(app_handle);
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}
