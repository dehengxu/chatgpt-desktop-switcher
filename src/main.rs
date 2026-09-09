use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const APP_PATH: &str = "/Applications/ChatGPT.app";
const APP_EXECUTABLE: &str = "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT";
const DEFAULT_PROFILE: &str = "default";
const CONVENIENCE_LINK_NAME: &str = ".chatgpt-desktop-switcher";

// UI文言はフロントエンド側の辞書で組み立てるため、バックエンドは
// ロケール非依存のエラーコードとパラメータのみを返す。
#[derive(Debug, Serialize)]
struct AppError {
    code: &'static str,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    params: BTreeMap<&'static str, String>,
}

impl AppError {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            params: BTreeMap::new(),
        }
    }

    fn with_param(mut self, key: &'static str, value: impl Into<String>) -> Self {
        self.params.insert(key, value.into());
        self
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        unexpected(error)
    }
}

fn unexpected(error: impl std::fmt::Display) -> AppError {
    AppError::new("unexpectedError").with_param("message", error.to_string())
}

#[derive(Debug, Deserialize, Serialize)]
struct ProfileMeta {
    name: String,
    created_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileView {
    name: String,
    is_default: bool,
    running: bool,
    pid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RunningInstance {
    pid: u32,
    args: String,
}

fn app_data_dir() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::new("homeDirUnavailable"))?;
    Ok(home
        .join("Library/Application Support")
        .join("ChatGPT Desktop Switcher"))
}

fn profiles_dir() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("profiles"))
}

fn initialize_app_data() -> Result<(), AppError> {
    let data_dir = app_data_dir()?;
    fs::create_dir_all(data_dir.join("profiles"))?;

    let home = dirs::home_dir().ok_or_else(|| AppError::new("homeDirUnavailable"))?;
    ensure_convenience_link(&data_dir, &home.join(CONVENIENCE_LINK_NAME))
}

fn ensure_convenience_link(data_dir: &Path, link_path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(link_path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target = fs::read_link(link_path)?;
            if target == data_dir {
                Ok(())
            } else {
                Err(AppError::new("symlinkTargetMismatch")
                    .with_param("path", link_path.display().to_string()))
            }
        }
        Ok(_) => Err(AppError::new("symlinkPathExists")
            .with_param("path", link_path.display().to_string())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(std::os::unix::fs::symlink(data_dir, link_path)?)
        }
        Err(error) => Err(error.into()),
    }
}

fn profile_dir(name: &str) -> Result<PathBuf, AppError> {
    validate_profile_name(name)?;
    Ok(profiles_dir()?.join(name))
}

fn validate_profile_name(name: &str) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::new("profileNameRequired"));
    }
    if name == DEFAULT_PROFILE {
        return Err(AppError::new("profileNameReserved"));
    }
    if name.chars().count() > 40 {
        return Err(AppError::new("profileNameTooLong"));
    }
    if name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '\0'))
    {
        return Err(AppError::new("profileNameInvalidChars"));
    }
    Ok(())
}

#[tauri::command]
fn create_profile(name: String) -> Result<Vec<ProfileView>, AppError> {
    let name = name.trim();
    validate_profile_name(name)?;

    let dir = profile_dir(name)?;
    if dir.exists() {
        return Err(AppError::new("profileAlreadyExists"));
    }

    fs::create_dir_all(dir.join("gui"))?;
    fs::create_dir_all(dir.join("cli"))?;

    let meta = ProfileMeta {
        name: name.to_string(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(unexpected)?
            .as_secs(),
    };
    let json = serde_json::to_string_pretty(&meta).map_err(unexpected)?;
    fs::write(dir.join("profile.json"), json)?;

    list_profiles()
}

#[tauri::command]
fn list_profiles() -> Result<Vec<ProfileView>, AppError> {
    let instances = running_instances()?;
    let mut profiles = vec![profile_view(DEFAULT_PROFILE, true, &instances)?];
    let root = profiles_dir()?;
    fs::create_dir_all(&root)?;

    let mut names = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let meta_path = entry.path().join("profile.json");
        let Ok(json) = fs::read_to_string(meta_path) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<ProfileMeta>(&json) else {
            continue;
        };
        if validate_profile_name(&meta.name).is_ok() {
            names.push(meta.name);
        }
    }
    names.sort_by_key(|name| name.to_lowercase());
    for name in names {
        profiles.push(profile_view(&name, false, &instances)?);
    }
    Ok(profiles)
}

fn profile_view(
    name: &str,
    is_default: bool,
    instances: &[RunningInstance],
) -> Result<ProfileView, AppError> {
    let gui_dir = if is_default {
        None
    } else {
        Some(profile_dir(name)?.join("gui"))
    };
    let pid = pid_for_profile(gui_dir.as_deref(), instances);
    Ok(ProfileView {
        name: name.to_string(),
        is_default,
        running: pid.is_some(),
        pid,
    })
}

#[tauri::command]
fn launch_profile(name: String) -> Result<(), AppError> {
    if !Path::new(APP_PATH).exists() {
        return Err(AppError::new("appNotFound"));
    }

    let instances = running_instances()?;
    let is_default = name == DEFAULT_PROFILE;
    let gui_dir = if is_default {
        None
    } else {
        let dir = profile_dir(&name)?;
        if !dir.join("profile.json").exists() {
            return Err(AppError::new("profileNotFound"));
        }
        Some(dir.join("gui"))
    };

    if let Some(pid) = pid_for_profile(gui_dir.as_deref(), &instances) {
        activate_pid(pid)?;
        return Ok(());
    }

    let mut command = Command::new("open");
    if is_default {
        command.arg("-a").arg(APP_PATH);
    } else {
        let dir = profile_dir(&name)?;
        let cli_dir = dir.join("cli");
        let gui_dir = dir.join("gui");
        command
            .arg("-n")
            .arg("-a")
            .arg(APP_PATH)
            .arg("--env")
            .arg(format!("CODEX_HOME={}", cli_dir.display()))
            .arg("--args")
            .arg(format!("--user-data-dir={}", gui_dir.display()));
    }

    let status = command.status()?;
    if !status.success() {
        return Err(AppError::new("launchFailed"));
    }
    Ok(())
}

#[tauri::command]
fn stop_profile(name: String) -> Result<(), AppError> {
    let instances = running_instances()?;
    let gui_dir = if name == DEFAULT_PROFILE {
        None
    } else {
        Some(profile_dir(&name)?.join("gui"))
    };
    let Some(pid) = pid_for_profile(gui_dir.as_deref(), &instances) else {
        return Ok(());
    };

    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::new("stopFailed"))
    }
}

fn activate_pid(pid: u32) -> Result<(), AppError> {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)
        .ok_or_else(|| AppError::new("activateFailed"))?;
    app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
    Ok(())
}

fn running_instances() -> Result<Vec<RunningInstance>, AppError> {
    let output = Command::new("ps")
        .args(["-ww", "-axo", "pid=,args="])
        .output()?;
    if !output.status.success() {
        return Err(AppError::new("processListFailed"));
    }
    Ok(parse_running_instances(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_running_instances(output: &str) -> Vec<RunningInstance> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let split = line.find(char::is_whitespace)?;
            let pid = line[..split].parse().ok()?;
            let args = line[split..].trim_start();
            let is_main = args == APP_EXECUTABLE
                || args
                    .strip_prefix(APP_EXECUTABLE)
                    .is_some_and(|rest| rest.starts_with(char::is_whitespace));
            is_main.then(|| RunningInstance {
                pid,
                args: args.to_string(),
            })
        })
        .collect()
}

fn pid_for_profile(gui_dir: Option<&Path>, instances: &[RunningInstance]) -> Option<u32> {
    match gui_dir {
        Some(dir) => {
            let flag = format!("--user-data-dir={}", dir.display());
            instances
                .iter()
                .find(|instance| contains_argument(&instance.args, &flag))
                .map(|instance| instance.pid)
        }
        None => instances
            .iter()
            .find(|instance| !instance.args.contains("--user-data-dir="))
            .map(|instance| instance.pid),
    }
}

fn contains_argument(args: &str, expected: &str) -> bool {
    let mut from = 0;
    while let Some(relative_start) = args[from..].find(expected) {
        let start = from + relative_start;
        let end = start + expected.len();
        let starts_at_boundary = start == 0 || args.as_bytes()[start - 1].is_ascii_whitespace();
        let ends_at_boundary = end == args.len() || args.as_bytes()[end].is_ascii_whitespace();
        if starts_at_boundary && ends_at_boundary {
            return true;
        }
        from = end;
    }
    false
}

fn main() {
    if let Err(error) = initialize_app_data() {
        eprintln!("failed to initialize the data directory: {error:?}");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_profile,
            list_profiles,
            launch_profile,
            stop_profile
        ])
        .run(tauri::generate_context!())
        .expect("failed to run ChatGPT Desktop Switcher");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn profile_name_validation_rejects_reserved_and_paths() {
        assert!(validate_profile_name("work").is_ok());
        assert!(validate_profile_name("仕事用").is_ok());
        assert!(validate_profile_name("default").is_err());
        assert!(validate_profile_name("../work").is_err());
        assert!(validate_profile_name("work/personal").is_err());
    }

    #[test]
    fn app_error_serializes_code_with_optional_params() {
        let error = AppError::new("profileNameReserved");
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({ "code": "profileNameReserved" })
        );

        let error = AppError::new("symlinkTargetMismatch").with_param("path", "/tmp/link");
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({
                "code": "symlinkTargetMismatch",
                "params": { "path": "/tmp/link" }
            })
        );
    }

    #[test]
    fn parses_only_chatgpt_main_processes() {
        let output = format!(
            "  101 {APP_EXECUTABLE} --user-data-dir=/tmp/Work Profile/gui\n  102 /Applications/ChatGPT.app/Contents/Frameworks/ChatGPT Helper.app/Contents/MacOS/ChatGPT Helper --type=renderer\n  103 /bin/zsh\n"
        );
        assert_eq!(
            parse_running_instances(&output),
            vec![RunningInstance {
                pid: 101,
                args: format!("{APP_EXECUTABLE} --user-data-dir=/tmp/Work Profile/gui"),
            }]
        );
    }

    #[test]
    fn maps_default_and_named_profiles_to_pids() {
        let instances = vec![
            RunningInstance {
                pid: 101,
                args: APP_EXECUTABLE.into(),
            },
            RunningInstance {
                pid: 202,
                args: format!("{APP_EXECUTABLE} --user-data-dir=/tmp/work profile/gui"),
            },
        ];
        assert_eq!(pid_for_profile(None, &instances), Some(101));
        assert_eq!(
            pid_for_profile(Some(Path::new("/tmp/work profile/gui")), &instances),
            Some(202)
        );
    }

    #[test]
    fn profile_path_match_requires_an_argument_boundary() {
        let expected = "--user-data-dir=/tmp/work/gui";
        assert!(contains_argument(
            "/Applications/ChatGPT --flag --user-data-dir=/tmp/work/gui --another",
            expected
        ));
        assert!(!contains_argument(
            "/Applications/ChatGPT --user-data-dir=/tmp/work/gui-old",
            expected
        ));
    }

    #[test]
    fn creates_and_reuses_convenience_link() {
        let temp = tempdir().unwrap();
        let data_dir = temp
            .path()
            .join("Application Support/ChatGPT Desktop Switcher");
        fs::create_dir_all(&data_dir).unwrap();
        let link = temp.path().join(CONVENIENCE_LINK_NAME);

        ensure_convenience_link(&data_dir, &link).unwrap();
        ensure_convenience_link(&data_dir, &link).unwrap();

        assert_eq!(fs::read_link(link).unwrap(), data_dir);
    }

    #[test]
    fn does_not_replace_existing_path_or_different_link() {
        let temp = tempdir().unwrap();
        let data_dir = temp.path().join("data");
        let other_dir = temp.path().join("other");
        fs::create_dir_all(&data_dir).unwrap();
        fs::create_dir_all(&other_dir).unwrap();

        let existing = temp.path().join("existing");
        fs::create_dir(&existing).unwrap();
        assert!(ensure_convenience_link(&data_dir, &existing).is_err());
        assert!(existing.is_dir());

        let different_link = temp.path().join("different-link");
        std::os::unix::fs::symlink(&other_dir, &different_link).unwrap();
        assert!(ensure_convenience_link(&data_dir, &different_link).is_err());
        assert_eq!(fs::read_link(different_link).unwrap(), other_dir);
    }
}
