pub mod power_modules;

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const EVENT_PROVISION_LOG: &str = "provision-log";
const EVENT_PROVISION_PROGRESS: &str = "provision-progress";
const EVENT_PROVISION_FINISHED: &str = "provision-finished";
const EVENT_TRAY_ACTION: &str = "tray-action";

static LOG_SEQ: AtomicU64 = AtomicU64::new(1);

// ============================================================================
// 1. GDD Manifesto Structs (serde + serde_json)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemTweak {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalScript {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub command: String,
    #[serde(default)]
    pub interactive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WingetPackage {
    pub id: String,
    pub name: String,
    #[serde(default = "default_category")]
    pub category: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_cmd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_cmd: Option<String>,
}

fn default_category() -> String {
    "Geral".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DotfileMapping {
    pub id: String,
    pub label: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub kill_process: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DotfilesConfig {
    #[serde(default)]
    pub repo_url: String,
    #[serde(default)]
    pub mappings: Vec<DotfileMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryFile {
    pub id: String,
    pub label: String,
    pub path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultItem {
    pub id: String,
    pub label: String,
    pub source_path: String,
    pub bundle_subpath: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableApp {
    pub id: String,
    pub name: String,
    pub zip_url: String,
    pub extract_to: String,
    #[serde(default)]
    pub add_to_path: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_cmd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_cmd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutostartTask {
    pub name: String,
    pub exe_path: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub run_as_admin: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyRemapRule {
    pub from_key: String,
    pub to_key: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileConfig {
    pub profile_name: String,
    #[serde(default = "default_author")]
    pub author: String,
    #[serde(default = "default_restore_point")]
    pub create_restore_point: bool,
    #[serde(default)]
    pub system_tweaks: Vec<SystemTweak>,
    #[serde(default)]
    pub external_scripts: Vec<ExternalScript>,
    #[serde(default)]
    pub winget_packages: Vec<WingetPackage>,
    #[serde(default)]
    pub dotfiles: DotfilesConfig,
    #[serde(default)]
    pub registry_files: Vec<RegistryFile>,
    // --- HARVEST, Bundle, Autostart & Key Remapper Extension Fields (all #[serde(default)] for backwards compatibility) ---
    #[serde(default)]
    pub bundle_root: Option<String>,
    #[serde(default)]
    pub vault_items: Vec<VaultItem>,
    #[serde(default)]
    pub vscode_extensions: Vec<String>,
    #[serde(default)]
    pub portable_apps: Vec<PortableApp>,
    #[serde(default)]
    pub backup_wifi: bool,
    #[serde(default)]
    pub backup_drivers: bool,
    #[serde(default)]
    pub extra_save_paths: Vec<String>,
    #[serde(default)]
    pub autostart_tasks: Vec<AutostartTask>,
    #[serde(default)]
    pub key_remaps: Vec<KeyRemapRule>,
}

fn default_author() -> String {
    "User".to_string()
}

fn default_restore_point() -> bool {
    true
}

fn default_true() -> bool {
    true
}

// ============================================================================
// 2. Frontend Event Payloads & Shared Pipeline State
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct LogPayload {
    pub id: String,
    pub timestamp: String,
    pub level: String,
    pub stage: u8,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub stage: u8,
    pub stage_label: String,
    pub progress: u8,
    pub status: String,
    pub current_task: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionFinishedPayload {
    pub dry_run: bool,
    pub status: String,
    pub success_count: usize,
    pub failure_count: usize,
    pub failed_report_path: Option<String>,
    pub failed_profile: Option<ProfileConfig>,
}

pub struct ProvisionState {
    pub is_running: Arc<AtomicBool>,
    pub cancel_flag: Arc<AtomicBool>,
}

impl Default for ProvisionState {
    fn default() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }
}

// ============================================================================
// 3. Event Sink & Helpers (Tauri GUI Events OR Headless CLI Stdout)
// ============================================================================

#[derive(Clone)]
pub enum EventSink {
    Tauri(AppHandle),
    Stdout(Arc<std::sync::Mutex<Option<ProvisionFinishedPayload>>>),
}

impl EventSink {
    pub fn stdout() -> (Self, Arc<std::sync::Mutex<Option<ProvisionFinishedPayload>>>) {
        let slot = Arc::new(std::sync::Mutex::new(None));
        (EventSink::Stdout(Arc::clone(&slot)), slot)
    }
}

/// Emits a structured log line to the React Live Terminal (`provision-log`) or directly to stdout in CLI mode.
pub fn emit_log(sink: &EventSink, level: &str, stage: u8, message: impl Into<String>) {
    let timestamp = Local::now().format("%H:%M:%S").to_string();
    let msg = message.into();
    match sink {
        EventSink::Tauri(app) => {
            let seq = LOG_SEQ.fetch_add(1, Ordering::Relaxed);
            let payload = LogPayload {
                id: format!("rust_{}_{}", Local::now().timestamp_millis(), seq),
                timestamp,
                level: level.to_string(),
                stage,
                message: msg,
            };
            let _ = app.emit(EVENT_PROVISION_LOG, payload);
        }
        EventSink::Stdout(_) => {
            use std::io::Write;
            println!("[{}] [S{}] [{}] {}", timestamp, stage, level, msg);
            let _ = std::io::stdout().flush();
        }
    }
}

fn emit_progress(
    sink: &EventSink,
    stage: u8,
    stage_label: &str,
    progress: u8,
    status: &str,
    current_task: Option<String>,
) {
    if let EventSink::Tauri(app) = sink {
        let payload = ProgressPayload {
            stage,
            stage_label: stage_label.to_string(),
            progress: progress.min(100),
            status: status.to_string(),
            current_task,
        };
        let _ = app.emit(EVENT_PROVISION_PROGRESS, payload);
    }
}

fn emit_finished(sink: &EventSink, payload: ProvisionFinishedPayload) {
    match sink {
        EventSink::Tauri(app) => {
            let _ = app.emit(EVENT_PROVISION_FINISHED, payload);
        }
        EventSink::Stdout(slot) => {
            use std::io::Write;
            println!(
                "[WINFORGE] Finalizado (status={}, dry_run={}) — {} sucesso(s), {} falha(s).",
                payload.status, payload.dry_run, payload.success_count, payload.failure_count
            );
            if let Some(ref report) = payload.failed_report_path {
                println!("[WINFORGE] Relatório de falhas salvo em: {}", report);
            }
            let _ = std::io::stdout().flush();
            if let Ok(mut guard) = slot.lock() {
                *guard = Some(payload);
            }
        }
    }
}

// ============================================================================
// 4. Windows Elevation Check (`IsUserAnAdmin`)
// ============================================================================

fn is_user_admin_native() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Shell::IsUserAnAdmin;
        // SAFETY: `IsUserAnAdmin` is a thread-safe Win32 Shell API taking no parameters.
        unsafe { IsUserAnAdmin().as_bool() }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
fn check_admin() -> bool {
    is_user_admin_native()
}

// ============================================================================
// 5. System Helpers: Env Vars, Taskkill, Recursive Copy & Streaming Execution
// ============================================================================

/// Resolves `%APPDATA%`, `%USERPROFILE%`, `%LOCALAPPDATA%` (and any other `%VAR%`)
/// using `std::env::var`.
pub fn resolve_windows_env_vars(raw_path: &str) -> String {
    let mut resolved = raw_path.to_string();

    // Explicitly check the primary Windows profile variables first (case-insensitive)
    for var_name in ["APPDATA", "USERPROFILE", "LOCALAPPDATA", "TEMP", "PROGRAMDATA"] {
        if let Ok(value) = env::var(var_name) {
            let token_upper = format!("%{}%", var_name);
            let token_lower = format!("%{}%", var_name.to_lowercase());
            resolved = resolved.replace(&token_upper, &value);
            resolved = resolved.replace(&token_lower, &value);
        }
    }

    // Generic pass for any remaining `%ENV_VAR%` tokens
    let mut output = String::with_capacity(resolved.len());
    let chars: Vec<char> = resolved.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '%' {
            if let Some(end_offset) = chars[i + 1..].iter().position(|&c| c == '%') {
                let var_key: String = chars[i + 1..i + 1 + end_offset].iter().collect();
                if !var_key.is_empty()
                    && var_key
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_')
                {
                    if let Ok(val) = env::var(&var_key) {
                        output.push_str(&val);
                        i += end_offset + 2;
                        continue;
                    }
                }
            }
        }
        output.push(chars[i]);
        i += 1;
    }

    output
}

/// Applies `CREATE_NO_WINDOW` (0x08000000) on Windows to prevent flashing console windows.
fn apply_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = cmd;
    }
}

/// Terminates a running process via `taskkill /F /IM <process>.exe`, silently ignoring
/// errors when the process is not currently running.
fn kill_process_silent(app: &EventSink, stage: u8, process_name: &str) {
    let trimmed = process_name.trim();
    if trimmed.is_empty() {
        return;
    }

    // Strip unsafe characters and ensure `.exe` suffix
    let sanitized: String = trimmed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    if sanitized.is_empty() {
        return;
    }

    let image_name = if sanitized.to_ascii_lowercase().ends_with(".exe") {
        sanitized
    } else {
        format!("{}.exe", sanitized)
    };

    emit_log(
        app,
        "WARN",
        stage,
        format!("Encerrando processo ativo: taskkill /F /IM {}", image_name),
    );

    let mut cmd = Command::new("taskkill");
    cmd.args(["/F", "/IM", &image_name])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);

    // Intentionally ignore non-zero status (e.g. exit code 128 when process isn't running)
    let _ = cmd.status();
}

/// Native recursive directory copy that creates destination folders and overwrites existing files.
pub fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(dst)?;
    let mut copied_files = 0usize;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copied_files += copy_dir_all(&src_path, &dst_path)?;
        } else {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src_path, &dst_path)?;
            copied_files += 1;
        }
    }

    Ok(copied_files)
}

/// Copies a dotfile mapping `source` (supporting trailing `/*` directory glob or direct file/folder)
/// from the cloned repository into `target`.
fn apply_dotfile_copy(repo_root: &Path, source_spec: &str, target_dir: &Path) -> std::io::Result<usize> {
    let normalized_source = source_spec.trim().replace('\\', "/");

    // Case 1: wildcard suffix like "yasb/*" -> copy contents of repo_root/yasb into target_dir
    if let Some(stripped) = normalized_source.strip_suffix("/*") {
        let src_dir = repo_root.join(stripped);
        if !src_dir.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Pasta de origem não encontrada no repositório: {}", src_dir.display()),
            ));
        }
        return copy_dir_all(&src_dir, target_dir);
    }

    let src_path = repo_root.join(&normalized_source);
    if !src_path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Origem não encontrada no repositório: {}", src_path.display()),
        ));
    }

    if src_path.is_dir() {
        copy_dir_all(&src_path, target_dir)
    } else {
        fs::create_dir_all(target_dir)?;
        let file_name = src_path.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "Nome de arquivo inválido")
        })?;
        fs::copy(&src_path, target_dir.join(file_name))?;
        Ok(1)
    }
}

/// Executes a command silently (`CREATE_NO_WINDOW`) and streams `stdout` & `stderr`
/// line-by-line to the React Live Terminal (or CLI stdout) in real time.
fn run_command_streaming(
    app: &EventSink,
    stage: u8,
    program: &str,
    args: &[&str],
    cancel_flag: &Arc<AtomicBool>,
) -> Result<i32, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Falha ao iniciar '{}': {}", program, e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_out = app.clone();
    let stdout_handle = thread::spawn(move || {
        if let Some(out) = stdout {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                let clean = line.trim();
                if !clean.is_empty() {
                    emit_log(&app_out, "INFO", stage, clean);
                }
            }
        }
    });

    let app_err = app.clone();
    let stderr_handle = thread::spawn(move || {
        if let Some(err) = stderr {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let clean = line.trim();
                if !clean.is_empty() {
                    emit_log(&app_err, "WARN", stage, clean);
                }
            }
        }
    });

    // Poll child so Abort works responsively without hanging indefinitely
    let exit_code = loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
            return Err("ABORTED".to_string());
        }

        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => thread::sleep(std::time::Duration::from_millis(80)),
            Err(e) => {
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err(format!("Erro ao aguardar processo '{}': {}", program, e));
            }
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    Ok(exit_code)
}

/// Checks whether a WinGet package ID is already installed to avoid redundant installs.
fn is_winget_package_installed(pkg_id: &str) -> bool {
    let mut cmd = Command::new("winget");
    cmd.args([
        "list",
        "--exact",
        "--id",
        pkg_id,
        "--accept-source-agreements",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    apply_no_window(&mut cmd);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.to_ascii_lowercase().contains(&pkg_id.to_ascii_lowercase())
        }
        _ => false,
    }
}

// ============================================================================
// 6. Main 5-Stage Provisioning Engine (`run_provisioning` & `abort_provisioning`)
// ============================================================================

#[tauri::command]
fn abort_provisioning(app: AppHandle, state: State<'_, ProvisionState>) {
    if state.is_running.load(Ordering::Relaxed) {
        state.cancel_flag.store(true, Ordering::Relaxed);
        let sink = EventSink::Tauri(app);
        emit_log(
            &sink,
            "WARN",
            0,
            "Sinal de interrupção recebido — encerrando tarefa atual...",
        );
    }
}

#[tauri::command]
async fn run_provisioning(
    app: AppHandle,
    state: State<'_, ProvisionState>,
    profile: ProfileConfig,
    dry_run: bool,
) -> Result<(), String> {
    if state.is_running.swap(true, Ordering::SeqCst) {
        return Err("Uma execução de provisionamento já está em andamento.".to_string());
    }
    state.cancel_flag.store(false, Ordering::SeqCst);

    let is_running = Arc::clone(&state.is_running);
    let cancel_flag = Arc::clone(&state.cancel_flag);
    let sink = EventSink::Tauri(app);

    // Run blocking OS/PowerShell/WinGet/Git operations on a dedicated OS thread
    thread::spawn(move || {
        if dry_run {
            let _ = execute_dry_run_pipeline(&sink, &profile, &cancel_flag);
        } else {
            let _ = execute_pipeline(&sink, &profile, &cancel_flag);
        }
        is_running.store(false, Ordering::SeqCst);
        cancel_flag.store(false, Ordering::SeqCst);
    });

    Ok(())
}

fn check_aborted(app: &EventSink, cancel_flag: &Arc<AtomicBool>) -> bool {
    if cancel_flag.load(Ordering::Relaxed) {
        emit_log(app, "WARN", 0, "Execução abortada manualmente pelo usuário.");
        emit_progress(
            app,
            0,
            "Execução Abortada",
            0,
            "aborted",
            Some("Interrompido pelo usuário".to_string()),
        );
        return true;
    }
    false
}

/// Escapes single quotes for safe embedding inside PowerShell single-quoted literals.
fn ps_single_quote(input: &str) -> String {
    input.replace('\'', "''")
}

/// Checks if a URL responds with HTTP 200 via PowerShell `Invoke-WebRequest -Method Head`.
fn check_http_head_status(url: &str) -> Result<u16, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("URL inválida (deve começar com http:// ou https://)".to_string());
    }
    let ps_cmd = format!(
        "$ProgressPreference = 'SilentlyContinue'; (Invoke-WebRequest -Uri '{}' -Method Head -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 15).StatusCode",
        ps_single_quote(trimmed)
    );
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &ps_cmd,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("Erro ao invocar Invoke-WebRequest: {}", e))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(err.lines().next().unwrap_or("Falha na requisição HEAD").trim().to_string());
    }

    let code_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    code_str
        .parse::<u16>()
        .map_err(|_| format!("Código HTTP inesperado: '{}'", code_str))
}

/// Validates whether a WinGet package ID exists in the catalog without installing it.
fn is_winget_id_valid(pkg_id: &str) -> bool {
    let mut cmd = Command::new("winget");
    cmd.args([
        "show",
        "--id",
        pkg_id,
        "--exact",
        "--accept-source-agreements",
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    apply_no_window(&mut cmd);

    matches!(cmd.status(), Ok(s) if s.success())
}

/// Resolves VS Code CLI executable name (`code.cmd` on Windows, `code` fallback).
fn resolve_vscode_cli() -> Option<&'static str> {
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["code.cmd", "code"]
    } else {
        &["code"]
    };
    for &bin in candidates {
        let mut cmd = Command::new(bin);
        cmd.arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        apply_no_window(&mut cmd);
        if matches!(cmd.status(), Ok(s) if s.success()) {
            return Some(bin);
        }
    }
    None
}

/// Restores a backed-up Vault item from `bundle_src` into `target_dst`.
/// Handles both directories (e.g. `.ssh`) and single files stored inside a bundle subfolder
/// (e.g. `vault/gitconfig/.gitconfig` -> `%USERPROFILE%\.gitconfig`).
fn restore_vault_item(bundle_src: &Path, target_dst: &Path) -> std::io::Result<usize> {
    if !bundle_src.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Item ausente no bundle: {}", bundle_src.display()),
        ));
    }

    if bundle_src.is_file() {
        if let Some(parent) = target_dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(bundle_src, target_dst)?;
        return Ok(1);
    }

    // If target looks like a specific file (e.g. .gitconfig, .npmrc, settings.json)
    // and bundle_src contains a matching file inside the subfolder, copy that file directly.
    if let Some(target_file_name) = target_dst.file_name() {
        let nested_file = bundle_src.join(target_file_name);
        if nested_file.is_file() && (!target_dst.exists() || target_dst.is_file()) {
            if let Some(parent) = target_dst.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&nested_file, target_dst)?;
            return Ok(1);
        }
    }

    copy_dir_all(bundle_src, target_dst)
}

/// Executes an optional per-package PowerShell hook (`pre_cmd` or `post_cmd`)
/// for `winget_packages` and `portable_apps`, streaming output and errors via `provision-log`.
fn run_package_hook(
    app: &EventSink,
    stage: u8,
    pkg_label: &str,
    hook_kind: &str,
    cmd_opt: &Option<String>,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let raw_cmd = match cmd_opt.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(()),
    };

    emit_log(
        app,
        "INFO",
        stage,
        format!("[HOOK {}] {}: {}", hook_kind, pkg_label, raw_cmd),
    );

    let code = match run_command_streaming(
        app,
        stage,
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            raw_cmd,
        ],
        cancel_flag,
    ) {
        Ok(c) => c,
        Err(ref e) if e == "ABORTED" => return Err("ABORTED".to_string()),
        Err(spawn_err) => {
            return Err(format!(
                "[HOOK {}] Falha ao executar PowerShell para '{}': {}",
                hook_kind, pkg_label, spawn_err
            ));
        }
    };

    if code == 0 {
        emit_log(
            app,
            "OK",
            stage,
            format!("[HOOK {}] {} concluído com sucesso.", hook_kind, pkg_label),
        );
        Ok(())
    } else {
        Err(format!(
            "[HOOK {}] Falhou com código {} para '{}'",
            hook_kind, code, pkg_label
        ))
    }
}

/// Sanitizes a Task Scheduler task name and prefixes with `WinForge\`.
fn format_schtasks_name(raw_name: &str) -> String {
    let cleaned: String = raw_name
        .trim()
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim();
    let leaf = if trimmed.is_empty() {
        "AutostartTask"
    } else {
        trimmed
    };
    format!("WinForge\\{}", leaf)
}

/// Formats the `/tr` command string for `schtasks /create`.
fn format_schtasks_tr(exe_path: &str, args: &str) -> String {
    let resolved_exe = resolve_windows_env_vars(exe_path.trim());
    let resolved_args = resolve_windows_env_vars(args.trim());
    if resolved_args.is_empty() {
        format!("\"{}\"", resolved_exe)
    } else {
        format!("\"{}\" {}", resolved_exe, resolved_args)
    }
}

/// Creates a Windows Task Scheduler ONLOGON entry via `schtasks /create /sc onlogon`
/// (appending `/rl highest` when `run_as_admin` is true).
fn deploy_autostart_task(
    app: &EventSink,
    stage: u8,
    task: &AutostartTask,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let resolved_exe = resolve_windows_env_vars(task.exe_path.trim());
    if resolved_exe.is_empty() {
        return Err(format!("exe_path vazio para tarefa '{}'.", task.name));
    }

    if task.run_as_admin && !is_user_admin_native() {
        emit_log(
            app,
            "WARN",
            stage,
            format!(
                "Autostart [{}] solicita /rl highest (Admin), mas o WinForge não está elevado.",
                task.name
            ),
        );
    }

    let task_name = format_schtasks_name(&task.name);
    let task_run = format_schtasks_tr(&task.exe_path, &task.args);

    let mut args: Vec<&str> = vec![
        "/create",
        "/sc",
        "onlogon",
        "/tn",
        &task_name,
        "/tr",
        &task_run,
        "/f",
    ];
    if task.run_as_admin {
        args.push("/rl");
        args.push("highest");
    }

    emit_log(
        app,
        "INFO",
        stage,
        format!(
            "schtasks /create /sc onlogon /tn \"{}\" /tr {} /f{}",
            task_name,
            task_run,
            if task.run_as_admin { " /rl highest" } else { "" }
        ),
    );

    let code = run_command_streaming(app, stage, "schtasks", &args, cancel_flag)?;
    if code == 0 {
        Ok(())
    } else {
        Err(format!(
            "schtasks retornou código {} ao registrar '{}'",
            code, task_name
        ))
    }
}

/// Downloads a portable `.zip`, extracts it with PowerShell `Expand-Archive`, and optionally
/// appends `extract_to` to the User PATH environment variable without duplicates.
fn deploy_portable_app(
    app: &EventSink,
    stage: u8,
    portable: &PortableApp,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let url = portable.zip_url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("URL inválida para app portátil '{}': {}", portable.name, url));
    }

    let resolved_dest = resolve_windows_env_vars(portable.extract_to.trim());
    if resolved_dest.is_empty() {
        return Err(format!("Caminho extract_to vazio para '{}'.", portable.name));
    }
    let dest_path = PathBuf::from(&resolved_dest);
    fs::create_dir_all(&dest_path)
        .map_err(|e| format!("Falha ao criar destino '{}': {}", dest_path.display(), e))?;

    let safe_slug = sanitize_folder_slug(&portable.id, "portable");
    let temp_zip = env::temp_dir().join(format!("winforge-portable-{}.zip", safe_slug));
    if temp_zip.exists() {
        let _ = fs::remove_file(&temp_zip);
    }

    let zip_str = temp_zip.to_string_lossy().to_string();
    let dest_str = dest_path.to_string_lossy().to_string();

    emit_log(
        app,
        "INFO",
        stage,
        format!("Baixando app portátil [{}]: {}", portable.name, url),
    );
    let download_cmd = format!(
        "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing",
        ps_single_quote(url),
        ps_single_quote(&zip_str)
    );
    let dl_code = run_command_streaming(
        app,
        stage,
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &download_cmd,
        ],
        cancel_flag,
    )?;
    if dl_code != 0 {
        let _ = fs::remove_file(&temp_zip);
        return Err(format!("Download falhou com código {} para '{}'", dl_code, portable.name));
    }

    emit_log(
        app,
        "INFO",
        stage,
        format!("Extraindo '{}' -> '{}'", portable.name, dest_str),
    );
    let extract_cmd = format!(
        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
        ps_single_quote(&zip_str),
        ps_single_quote(&dest_str)
    );
    let ex_code = run_command_streaming(
        app,
        stage,
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &extract_cmd,
        ],
        cancel_flag,
    )?;
    let _ = fs::remove_file(&temp_zip);
    if ex_code != 0 {
        return Err(format!("Expand-Archive falhou com código {} para '{}'", ex_code, portable.name));
    }

    if portable.add_to_path {
        emit_log(
            app,
            "INFO",
            stage,
            format!("Adicionando '{}' ao PATH do usuário...", dest_str),
        );
        let path_cmd = format!(
            "$target = '{}'; $current = [Environment]::GetEnvironmentVariable('Path', 'User'); $parts = @(); if ($current) {{ $parts = $current -split ';' | Where-Object {{ $_ -ne '' }} }}; if (-not ($parts | Where-Object {{ $_.TrimEnd('\\') -ieq $target.TrimEnd('\\') }})) {{ $newPath = if ($current) {{ \"$current;$target\" }} else {{ $target }}; [Environment]::SetEnvironmentVariable('Path', $newPath, 'User'); Write-Output \"PATH atualizado com: $target\" }} else {{ Write-Output \"Já presente no PATH: $target\" }}",
            ps_single_quote(&dest_str)
        );
        let path_code = run_command_streaming(
            app,
            stage,
            "powershell.exe",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &path_cmd,
            ],
            cancel_flag,
        )?;
        if path_code != 0 {
            return Err(format!("Falha ao atualizar PATH do usuário (código {}).", path_code));
        }
    }

    Ok(())
}

/// Resolves the configured `bundle_root` directory if present.
fn resolve_bundle_root(profile: &ProfileConfig) -> Option<PathBuf> {
    profile
        .bundle_root
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|raw| PathBuf::from(resolve_windows_env_vars(raw)))
}

// ============================================================================
// 6A. DRY-RUN Simulation Pipeline (Zero Modifications)
// ============================================================================

fn execute_dry_run_pipeline(
    app: &EventSink,
    profile: &ProfileConfig,
    cancel_flag: &Arc<AtomicBool>,
) -> ProvisionFinishedPayload {
    let enabled_packages: Vec<&WingetPackage> =
        profile.winget_packages.iter().filter(|p| p.enabled).collect();
    let enabled_portables: Vec<&PortableApp> =
        profile.portable_apps.iter().filter(|p| p.enabled).collect();
    let enabled_vault: Vec<&VaultItem> =
        profile.vault_items.iter().filter(|v| v.enabled).collect();
    let enabled_regs: Vec<&RegistryFile> =
        profile.registry_files.iter().filter(|r| r.enabled).collect();
    let enabled_autostarts: Vec<&AutostartTask> =
        profile.autostart_tasks.iter().filter(|t| t.enabled).collect();

    let total_checks = (2
        + enabled_vault.len()
        + enabled_packages.len()
        + enabled_portables.len()
        + enabled_regs.len()
        + enabled_autostarts.len())
    .max(1);
    let mut completed = 0usize;
    let mut success_count = 0usize;
    let mut failure_count = 0usize;

    let mut bump = |stage: u8, label: &str, task: Option<String>| {
        completed += 1;
        let pct = (((completed as f64) / (total_checks as f64)) * 99.0)
            .round()
            .clamp(2.0, 99.0) as u8;
        emit_progress(app, stage, label, pct, "running", task);
    };

    emit_progress(
        app,
        0,
        "[DRY-RUN] Validação de Pré-voo",
        2,
        "running",
        Some("Modo simulação ativo — nenhuma alteração será feita".to_string()),
    );
    emit_log(
        app,
        "WARN",
        0,
        format!(
            "[DRY-RUN] Iniciando validação segura para \"{}\". Nenhum programa será instalado e nenhum arquivo/registro será modificado.",
            profile.profile_name
        ),
    );

    // 1. Validate bundle_root & vault items + wifi XMLs + extra saves
    if let Some(bundle_dir) = resolve_bundle_root(profile) {
        if bundle_dir.exists() {
            emit_log(
                app,
                "OK",
                0,
                format!("[DRY-RUN] bundle_root encontrado: {}", bundle_dir.display()),
            );
            success_count += 1;

            for item in &enabled_vault {
                if check_aborted(app, cancel_flag) {
                    let payload = ProvisionFinishedPayload {
                        dry_run: true,
                        status: "aborted".to_string(),
                        success_count,
                        failure_count,
                        failed_report_path: None,
                        failed_profile: None,
                    };
                    emit_finished(app, payload.clone());
                    return payload;
                }
                let subpath = if item.bundle_subpath.trim().is_empty() {
                    format!("vault/{}", sanitize_folder_slug(&item.id, "item"))
                } else {
                    item.bundle_subpath.trim().replace('\\', "/")
                };
                let src_in_bundle = bundle_dir.join(&subpath);
                if src_in_bundle.exists() {
                    emit_log(
                        app,
                        "OK",
                        1,
                        format!(
                            "[DRY-RUN] Vault [{}] pronto no bundle: {} -> {}",
                            item.label,
                            src_in_bundle.display(),
                            resolve_windows_env_vars(&item.source_path)
                        ),
                    );
                    success_count += 1;
                } else {
                    emit_log(
                        app,
                        "ERR",
                        1,
                        format!(
                            "[DRY-RUN] Vault [{}] NÃO encontrado em {}",
                            item.label,
                            src_in_bundle.display()
                        ),
                    );
                    failure_count += 1;
                }
                bump(1, "[DRY-RUN] Validando Bundle & Vault", Some(item.label.clone()));
            }

            let wifi_dir = bundle_dir.join("vault").join("wifi");
            if wifi_dir.exists() {
                let xml_count = fs::read_dir(&wifi_dir)
                    .map(|entries| {
                        entries
                            .flatten()
                            .filter(|e| {
                                e.path()
                                    .extension()
                                    .and_then(|ext| ext.to_str())
                                    .map(|ext| ext.eq_ignore_ascii_case("xml"))
                                    .unwrap_or(false)
                            })
                            .count()
                    })
                    .unwrap_or(0);
                emit_log(
                    app,
                    "OK",
                    1,
                    format!(
                        "[DRY-RUN] vault/wifi detectado com {} perfil(is) XML pronto(s) para netsh wlan add.",
                        xml_count
                    ),
                );
                success_count += 1;
            }
        } else {
            emit_log(
                app,
                "WARN",
                0,
                format!(
                    "[DRY-RUN] bundle_root \"{}\" não encontrado localmente. Restauração de Vault/Wi-Fi seria pulada.",
                    bundle_dir.display()
                ),
            );
            failure_count += 1;
        }
    } else {
        emit_log(
            app,
            "INFO",
            0,
            "[DRY-RUN] Nenhum bundle_root definido — pulando validação de Vault local.",
        );
    }
    bump(0, "[DRY-RUN] Pré-voo concluído", None);

    // 2. Validate WinGet Package IDs
    emit_log(
        app,
        "INFO",
        2,
        format!(
            "[DRY-RUN] Validando {} ID(s) do WinGet no catálogo (winget show --exact)...",
            enabled_packages.len()
        ),
    );
    for pkg in &enabled_packages {
        if check_aborted(app, cancel_flag) {
            let payload = ProvisionFinishedPayload {
                dry_run: true,
                status: "aborted".to_string(),
                success_count,
                failure_count,
                failed_report_path: None,
                failed_profile: None,
            };
            emit_finished(app, payload.clone());
            return payload;
        }
        if let Some(ref pre) = pkg.pre_cmd {
            if !pre.trim().is_empty() {
                emit_log(
                    app,
                    "INFO",
                    2,
                    format!("[DRY-RUN] Hook pre_cmd de {}: {}", pkg.id, pre.trim()),
                );
            }
        }
        if is_winget_id_valid(&pkg.id) {
            emit_log(
                app,
                "OK",
                2,
                format!("[DRY-RUN] WinGet ID válido: {} ({})", pkg.id, pkg.name),
            );
            success_count += 1;
        } else {
            emit_log(
                app,
                "ERR",
                2,
                format!("[DRY-RUN] WinGet ID inválido ou inacessível: {} ({})", pkg.id, pkg.name),
            );
            failure_count += 1;
        }
        if let Some(ref post) = pkg.post_cmd {
            if !post.trim().is_empty() {
                emit_log(
                    app,
                    "INFO",
                    2,
                    format!("[DRY-RUN] Hook post_cmd de {}: {}", pkg.id, post.trim()),
                );
            }
        }
        bump(2, "[DRY-RUN] Validando WinGet IDs", Some(pkg.id.clone()));
    }

    // 3. Validate Portable Apps zip_url HTTP HEAD == 200
    if !enabled_portables.is_empty() {
        emit_log(
            app,
            "INFO",
            2,
            format!(
                "[DRY-RUN] Testando conectividade HTTP HEAD de {} app(s) portáteis...",
                enabled_portables.len()
            ),
        );
    }
    for portable in &enabled_portables {
        if check_aborted(app, cancel_flag) {
            let payload = ProvisionFinishedPayload {
                dry_run: true,
                status: "aborted".to_string(),
                success_count,
                failure_count,
                failed_report_path: None,
                failed_profile: None,
            };
            emit_finished(app, payload.clone());
            return payload;
        }
        if let Some(ref pre) = portable.pre_cmd {
            if !pre.trim().is_empty() {
                emit_log(
                    app,
                    "INFO",
                    2,
                    format!("[DRY-RUN] Hook pre_cmd de [{}]: {}", portable.name, pre.trim()),
                );
            }
        }
        match check_http_head_status(&portable.zip_url) {
            Ok(200) => {
                emit_log(
                    app,
                    "OK",
                    2,
                    format!(
                        "[DRY-RUN] Portable [{}] HTTP 200 OK -> {}",
                        portable.name, portable.zip_url
                    ),
                );
                success_count += 1;
            }
            Ok(status) => {
                emit_log(
                    app,
                    "WARN",
                    2,
                    format!(
                        "[DRY-RUN] Portable [{}] respondeu HTTP {} -> {}",
                        portable.name, status, portable.zip_url
                    ),
                );
                failure_count += 1;
            }
            Err(err) => {
                emit_log(
                    app,
                    "ERR",
                    2,
                    format!(
                        "[DRY-RUN] Portable [{}] falhou no HEAD: {} ({})",
                        portable.name, err, portable.zip_url
                    ),
                );
                failure_count += 1;
            }
        }
        if let Some(ref post) = portable.post_cmd {
            if !post.trim().is_empty() {
                emit_log(
                    app,
                    "INFO",
                    2,
                    format!("[DRY-RUN] Hook post_cmd de [{}]: {}", portable.name, post.trim()),
                );
            }
        }
        bump(2, "[DRY-RUN] Testando Portable Apps", Some(portable.name.clone()));
    }

    // 4. Validate VS Code CLI & Registry files
    if !profile.vscode_extensions.is_empty() {
        if resolve_vscode_cli().is_some() {
            emit_log(
                app,
                "OK",
                3,
                format!(
                    "[DRY-RUN] VS Code CLI disponível para {} extensão(ões).",
                    profile.vscode_extensions.len()
                ),
            );
            success_count += 1;
        } else {
            emit_log(
                app,
                "WARN",
                3,
                format!(
                    "[DRY-RUN] VS Code CLI ausente agora (será usado após WinGet instalar VS Code) — {} extensões listadas.",
                    profile.vscode_extensions.len()
                ),
            );
        }
    }

    for reg in &enabled_regs {
        let resolved_reg = resolve_windows_env_vars(&reg.path);
        if PathBuf::from(&resolved_reg).exists() {
            emit_log(
                app,
                "OK",
                4,
                format!("[DRY-RUN] Arquivo .reg encontrado: {}", resolved_reg),
            );
            success_count += 1;
        } else {
            emit_log(
                app,
                "ERR",
                4,
                format!("[DRY-RUN] Arquivo .reg não encontrado: {}", resolved_reg),
            );
            failure_count += 1;
        }
        bump(4, "[DRY-RUN] Validando Registros (.reg)", Some(reg.label.clone()));
    }

    for task in &enabled_autostarts {
        let resolved_exe = resolve_windows_env_vars(task.exe_path.trim());
        let tn = format_schtasks_name(&task.name);
        let tr = format_schtasks_tr(&task.exe_path, &task.args);
        let rl = if task.run_as_admin { " /rl highest" } else { "" };
        if resolved_exe.is_empty() {
            emit_log(
                app,
                "ERR",
                4,
                format!("[DRY-RUN] Autostart [{}] possui exe_path vazio.", task.name),
            );
            failure_count += 1;
        } else if PathBuf::from(&resolved_exe).exists() {
            emit_log(
                app,
                "OK",
                4,
                format!(
                    "[DRY-RUN] Autostart [{}] pronto: schtasks /create /sc onlogon /tn \"{}\" /tr {} /f{}",
                    task.name, tn, tr, rl
                ),
            );
            success_count += 1;
        } else {
            emit_log(
                app,
                "WARN",
                4,
                format!(
                    "[DRY-RUN] Autostart [{}] exe não encontrado agora ({}) — pode ser instalado durante o deploy. Comando: schtasks /create /sc onlogon /tn \"{}\" /tr {} /f{}",
                    task.name, resolved_exe, tn, tr, rl
                ),
            );
            success_count += 1;
        }
        bump(4, "[DRY-RUN] Validando Autostart", Some(task.name.clone()));
    }

    emit_log(
        app,
        if failure_count == 0 { "OK" } else { "WARN" },
        4,
        format!(
            "[DRY-RUN] Simulação concluída: {} verificação(ões) OK, {} alerta(s)/falha(s). Nenhuma alteração foi aplicada ao sistema.",
            success_count, failure_count
        ),
    );
    emit_progress(
        app,
        4,
        "[DRY-RUN] Validação Concluída",
        100,
        "completed",
        Some(format!("{} OK · {} falhas", success_count, failure_count)),
    );
    let summary = ProvisionFinishedPayload {
        dry_run: true,
        status: "completed".to_string(),
        success_count,
        failure_count,
        failed_report_path: None,
        failed_profile: None,
    };
    emit_finished(app, summary.clone());
    summary
}

// ============================================================================
// 6B. Full Deploy Pipeline (Real Execution + Failed Report)
// ============================================================================

#[derive(Default)]
struct FailedCollector {
    tweaks: Vec<SystemTweak>,
    scripts: Vec<ExternalScript>,
    packages: Vec<WingetPackage>,
    portable_apps: Vec<PortableApp>,
    vault_items: Vec<VaultItem>,
    dotfiles: Vec<DotfileMapping>,
    registry_files: Vec<RegistryFile>,
    vscode_extensions: Vec<String>,
    autostart_tasks: Vec<AutostartTask>,
}

impl FailedCollector {
    fn total_failures(&self) -> usize {
        self.tweaks.len()
            + self.scripts.len()
            + self.packages.len()
            + self.portable_apps.len()
            + self.vault_items.len()
            + self.dotfiles.len()
            + self.registry_files.len()
            + self.vscode_extensions.len()
            + self.autostart_tasks.len()
    }

    fn into_sub_profile(self, original: &ProfileConfig) -> ProfileConfig {
        ProfileConfig {
            profile_name: format!("{} [FAILED RETRY]", original.profile_name),
            author: original.author.clone(),
            create_restore_point: false,
            system_tweaks: self.tweaks,
            external_scripts: self.scripts,
            winget_packages: self.packages,
            dotfiles: DotfilesConfig {
                repo_url: original.dotfiles.repo_url.clone(),
                mappings: self.dotfiles,
            },
            registry_files: self.registry_files,
            bundle_root: original.bundle_root.clone(),
            vault_items: self.vault_items,
            vscode_extensions: self.vscode_extensions,
            portable_apps: self.portable_apps,
            backup_wifi: original.backup_wifi,
            backup_drivers: original.backup_drivers,
            extra_save_paths: vec![],
            autostart_tasks: self.autostart_tasks,
            key_remaps: original.key_remaps.clone(),
        }
    }
}

fn execute_pipeline(app: &EventSink, profile: &ProfileConfig, cancel_flag: &Arc<AtomicBool>) {
    let enabled_tweaks: Vec<&SystemTweak> =
        profile.system_tweaks.iter().filter(|t| t.enabled).collect();
    let enabled_scripts: Vec<&ExternalScript> =
        profile.external_scripts.iter().filter(|s| s.enabled).collect();
    let enabled_packages: Vec<&WingetPackage> =
        profile.winget_packages.iter().filter(|p| p.enabled).collect();
    let enabled_portables: Vec<&PortableApp> =
        profile.portable_apps.iter().filter(|p| p.enabled).collect();
    let enabled_vault: Vec<&VaultItem> =
        profile.vault_items.iter().filter(|v| v.enabled).collect();
    let enabled_mappings: Vec<&DotfileMapping> =
        profile.dotfiles.mappings.iter().filter(|m| m.enabled).collect();
    let enabled_regs: Vec<&RegistryFile> =
        profile.registry_files.iter().filter(|r| r.enabled).collect();
    let enabled_autostarts: Vec<&AutostartTask> =
        profile.autostart_tasks.iter().filter(|t| t.enabled).collect();
    let vscode_exts = &profile.vscode_extensions;

    let bundle_dir_opt = resolve_bundle_root(profile).filter(|p| p.exists());
    let has_git_dotfiles =
        !enabled_mappings.is_empty() && !profile.dotfiles.repo_url.trim().is_empty();
    let has_bundle_dotfiles = !enabled_mappings.is_empty()
        && profile.dotfiles.repo_url.trim().is_empty()
        && bundle_dir_opt
            .as_ref()
            .map(|b| b.join("dotfiles").exists())
            .unwrap_or(false);
    let has_dotfiles = has_git_dotfiles || has_bundle_dotfiles;

    let total_steps = (2
        + enabled_tweaks.len()
        + enabled_scripts.len()
        + enabled_packages.len()
        + enabled_portables.len()
        + vscode_exts.len()
        + if bundle_dir_opt.is_some() {
            enabled_vault.len() + 1
        } else {
            0
        }
        + if has_dotfiles {
            enabled_mappings.len() + 1
        } else {
            0
        }
        + enabled_regs.len()
        + enabled_autostarts.len()
        + 1)
    .max(1);

    let mut completed_steps: usize = 0;
    let mut success_count: usize = 0;
    let mut failed = FailedCollector::default();

    let mut calc_pct = |bump: bool| -> u8 {
        if bump {
            completed_steps += 1;
        }
        (((completed_steps as f64) / (total_steps as f64)) * 99.0)
            .round()
            .clamp(1.0, 99.0) as u8
    };

    let emit_abort_finished = |app: &EventSink, succ: usize, fail: usize| {
        emit_finished(
            app,
            ProvisionFinishedPayload {
                dry_run: false,
                status: "aborted".to_string(),
                success_count: succ,
                failure_count: fail,
                failed_report_path: None,
                failed_profile: None,
            },
        );
    };

    // ------------------------------------------------------------------------
    // ESTÁGIO 0 — Segurança & Pré-voo
    // ------------------------------------------------------------------------
    emit_progress(
        app,
        0,
        "Estágio 0: Segurança & Pré-voo",
        2,
        "running",
        Some("Verificando privilégios de Administrador".to_string()),
    );
    emit_log(
        app,
        "INFO",
        0,
        format!(
            "Iniciando pipeline WinForge para perfil \"{}\" (autor: {})",
            profile.profile_name, profile.author
        ),
    );

    if !is_user_admin_native() {
        emit_log(
            app,
            "ERR",
            0,
            "IsUserAnAdmin() retornou FALSE. Execute o WinForge como Administrador para modificar HKLM, WinGet e Pontos de Restauração.",
        );
        emit_progress(
            app,
            0,
            "Estágio 0: Privilégios Insuficientes",
            0,
            "error",
            Some("Requer elevação UAC".to_string()),
        );
        emit_finished(
            app,
            ProvisionFinishedPayload {
                dry_run: false,
                status: "error".to_string(),
                success_count: 0,
                failure_count: 1,
                failed_report_path: None,
                failed_profile: None,
            },
        );
        return;
    }

    emit_log(app, "OK", 0, "Privilégios elevados (UAC Administrador) confirmados.");
    let p = calc_pct(true);
    emit_progress(
        app,
        0,
        "Estágio 0: Segurança & Pré-voo",
        p,
        "running",
        Some("Verificando Ponto de Restauração".to_string()),
    );

    if check_aborted(app, cancel_flag) {
        emit_abort_finished(app, success_count, failed.total_failures());
        return;
    }

    if profile.create_restore_point {
        emit_log(
            app,
            "INFO",
            0,
            "Criando Ponto de Restauração do Windows via Checkpoint-Computer...",
        );
        let rp_cmd = "Enable-ComputerRestore -Drive \"$env:SystemDrive\\\"; Checkpoint-Computer -Description \"WinForge Pre-Provisioning\" -RestorePointType \"MODIFY_SETTINGS\"";
        match run_command_streaming(
            app,
            0,
            "powershell.exe",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                rp_cmd,
            ],
            cancel_flag,
        ) {
            Ok(0) => {
                emit_log(app, "OK", 0, "Ponto de Restauração criado com sucesso.");
                success_count += 1;
            }
            Ok(code) => emit_log(
                app,
                "WARN",
                0,
                format!(
                    "Checkpoint-Computer finalizou com código {} (o Windows limita criação a 1 ponto a cada 24h). Continuando...",
                    code
                ),
            ),
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => emit_log(app, "WARN", 0, format!("Aviso no Ponto de Restauração: {}", err)),
        }
    } else {
        emit_log(
            app,
            "WARN",
            0,
            "create_restore_point = false. Pulando criação do Ponto de Restauração.",
        );
    }

    let p = calc_pct(true);
    emit_progress(app, 0, "Estágio 0: Pré-voo concluído", p, "running", None);

    // ------------------------------------------------------------------------
    // ESTÁGIO 1 — Debloat & Registro
    // ------------------------------------------------------------------------
    if check_aborted(app, cancel_flag) {
        emit_abort_finished(app, success_count, failed.total_failures());
        return;
    }
    emit_log(
        app,
        "INFO",
        1,
        format!(
            "Estágio 1 — Aplicando {} tweak(s) de sistema e {} script(s) externo(s).",
            enabled_tweaks.len(),
            enabled_scripts.len()
        ),
    );

    for tweak in &enabled_tweaks {
        if check_aborted(app, cancel_flag) {
            emit_abort_finished(app, success_count, failed.total_failures());
            return;
        }
        emit_progress(
            app,
            1,
            "Estágio 1: Debloat & Registro",
            calc_pct(false),
            "running",
            Some(format!("Tweak: {}", tweak.label)),
        );
        emit_log(app, "INFO", 1, format!("[{}] Executando: {}", tweak.id, tweak.command));

        match run_command_streaming(
            app,
            1,
            "powershell.exe",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &tweak.command,
            ],
            cancel_flag,
        ) {
            Ok(0) => {
                emit_log(app, "OK", 1, format!("Tweak [{}] aplicado com sucesso.", tweak.id));
                success_count += 1;
            }
            Ok(code) => {
                emit_log(
                    app,
                    "ERR",
                    1,
                    format!("Tweak [{}] retornou código de saída {}.", tweak.id, code),
                );
                failed.tweaks.push((*tweak).clone());
            }
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(app, "ERR", 1, format!("Falha no tweak [{}]: {}", tweak.id, err));
                failed.tweaks.push((*tweak).clone());
            }
        }

        let p = calc_pct(true);
        emit_progress(app, 1, "Estágio 1: Debloat & Registro", p, "running", None);
    }

    for script in &enabled_scripts {
        if check_aborted(app, cancel_flag) {
            emit_abort_finished(app, success_count, failed.total_failures());
            return;
        }
        emit_progress(
            app,
            1,
            "Estágio 1: Scripts Externos",
            calc_pct(false),
            "running",
            Some(format!("Script: {}", script.label)),
        );

        if script.interactive {
            emit_log(
                app,
                "WARN",
                1,
                format!(
                    "Abrindo janela PowerShell interativa para [{}] ({})...",
                    script.id, script.label
                ),
            );
            let status = Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    &script.command,
                ])
                .status();

            match status {
                Ok(s) if s.success() => {
                    emit_log(
                        app,
                        "OK",
                        1,
                        format!("Script interativo [{}] concluído com sucesso.", script.id),
                    );
                    success_count += 1;
                }
                Ok(s) => {
                    emit_log(
                        app,
                        "ERR",
                        1,
                        format!(
                            "Script interativo [{}] encerrado com código {:?}.",
                            script.id,
                            s.code()
                        ),
                    );
                    failed.scripts.push((*script).clone());
                }
                Err(e) => {
                    emit_log(
                        app,
                        "ERR",
                        1,
                        format!("Falha ao abrir terminal interativo para [{}]: {}", script.id, e),
                    );
                    failed.scripts.push((*script).clone());
                }
            }
        } else {
            emit_log(
                app,
                "INFO",
                1,
                format!("Executando script oculto [{}]: {}", script.id, script.command),
            );
            match run_command_streaming(
                app,
                1,
                "powershell.exe",
                &[
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    &script.command,
                ],
                cancel_flag,
            ) {
                Ok(0) => {
                    emit_log(app, "OK", 1, format!("Script [{}] concluído.", script.id));
                    success_count += 1;
                }
                Ok(code) => {
                    emit_log(
                        app,
                        "ERR",
                        1,
                        format!("Script [{}] finalizou com código {}.", script.id, code),
                    );
                    failed.scripts.push((*script).clone());
                }
                Err(ref e) if e == "ABORTED" => {
                    check_aborted(app, cancel_flag);
                    emit_abort_finished(app, success_count, failed.total_failures());
                    return;
                }
                Err(err) => {
                    emit_log(app, "ERR", 1, format!("Erro no script [{}]: {}", script.id, err));
                    failed.scripts.push((*script).clone());
                }
            }
        }

        let p = calc_pct(true);
        emit_progress(app, 1, "Estágio 1: Debloat & Registro", p, "running", None);
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 2 — Pacotes WinGet + Apps Portáteis + Extensões VS Code
    // ------------------------------------------------------------------------
    if check_aborted(app, cancel_flag) {
        emit_abort_finished(app, success_count, failed.total_failures());
        return;
    }
    emit_log(
        app,
        "INFO",
        2,
        format!(
            "Estágio 2 — Provisionando {} pacote(s) WinGet, {} app(s) portáteis e {} extensão(ões) VS Code.",
            enabled_packages.len(),
            enabled_portables.len(),
            vscode_exts.len()
        ),
    );

    for pkg in &enabled_packages {
        if check_aborted(app, cancel_flag) {
            emit_abort_finished(app, success_count, failed.total_failures());
            return;
        }
        emit_progress(
            app,
            2,
            "Estágio 2: Pacotes WinGet",
            calc_pct(false),
            "running",
            Some(format!("WinGet: {} ({})", pkg.name, pkg.id)),
        );

        // Optional pre_cmd hook before package installation
        match run_package_hook(app, 2, &pkg.id, "pre_cmd", &pkg.pre_cmd, cancel_flag) {
            Ok(()) => {}
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(app, "ERR", 2, err);
                failed.packages.push((*pkg).clone());
                let p = calc_pct(true);
                emit_progress(app, 2, "Estágio 2: Pacotes WinGet", p, "running", None);
                continue;
            }
        }

        let install_ok = if is_winget_package_installed(&pkg.id) {
            emit_log(
                app,
                "OK",
                2,
                format!("{} ({}) já está instalado. Pulando download.", pkg.name, pkg.id),
            );
            true
        } else {
            emit_log(
                app,
                "INFO",
                2,
                format!(
                    "winget install --id {} --exact --silent --accept-package-agreements --accept-source-agreements",
                    pkg.id
                ),
            );

            match run_command_streaming(
                app,
                2,
                "winget",
                &[
                    "install",
                    "--id",
                    &pkg.id,
                    "--exact",
                    "--silent",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ],
                cancel_flag,
            ) {
                Ok(0) => {
                    emit_log(
                        app,
                        "OK",
                        2,
                        format!("{} ({}) instalado com sucesso.", pkg.name, pkg.id),
                    );
                    true
                }
                Ok(code) => {
                    emit_log(
                        app,
                        "ERR",
                        2,
                        format!(
                            "WinGet retornou código {} para {} ({}). Adicionado ao relatório de falhas.",
                            code, pkg.name, pkg.id
                        ),
                    );
                    false
                }
                Err(ref e) if e == "ABORTED" => {
                    check_aborted(app, cancel_flag);
                    emit_abort_finished(app, success_count, failed.total_failures());
                    return;
                }
                Err(err) => {
                    emit_log(
                        app,
                        "ERR",
                        2,
                        format!("Falha ao instalar {} ({}): {}", pkg.name, pkg.id, err),
                    );
                    false
                }
            }
        };

        if !install_ok {
            failed.packages.push((*pkg).clone());
            let p = calc_pct(true);
            emit_progress(app, 2, "Estágio 2: Pacotes WinGet", p, "running", None);
            continue;
        }

        // Optional post_cmd hook after package installation
        match run_package_hook(app, 2, &pkg.id, "post_cmd", &pkg.post_cmd, cancel_flag) {
            Ok(()) => {
                success_count += 1;
            }
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(app, "ERR", 2, err);
                failed.packages.push((*pkg).clone());
            }
        }

        let p = calc_pct(true);
        emit_progress(app, 2, "Estágio 2: Pacotes WinGet", p, "running", None);
    }

    // Portable Apps (.zip download + Expand-Archive + optional User PATH + pre/post hooks)
    for portable in &enabled_portables {
        if check_aborted(app, cancel_flag) {
            emit_abort_finished(app, success_count, failed.total_failures());
            return;
        }
        emit_progress(
            app,
            2,
            "Estágio 2: Apps Portáteis (.zip)",
            calc_pct(false),
            "running",
            Some(format!("Portable: {}", portable.name)),
        );

        // Optional pre_cmd hook before portable download/extract
        match run_package_hook(app, 2, &portable.name, "pre_cmd", &portable.pre_cmd, cancel_flag) {
            Ok(()) => {}
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(app, "ERR", 2, err);
                failed.portable_apps.push((*portable).clone());
                let p = calc_pct(true);
                emit_progress(app, 2, "Estágio 2: Apps Portáteis", p, "running", None);
                continue;
            }
        }

        let deploy_ok = match deploy_portable_app(app, 2, portable, cancel_flag) {
            Ok(()) => {
                emit_log(
                    app,
                    "OK",
                    2,
                    format!(
                        "App portátil [{}] extraído em '{}'{}.",
                        portable.name,
                        resolve_windows_env_vars(&portable.extract_to),
                        if portable.add_to_path { " (+ PATH)" } else { "" }
                    ),
                );
                true
            }
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(
                    app,
                    "ERR",
                    2,
                    format!("Falha no app portátil [{}]: {}", portable.name, err),
                );
                false
            }
        };

        if !deploy_ok {
            failed.portable_apps.push((*portable).clone());
            let p = calc_pct(true);
            emit_progress(app, 2, "Estágio 2: Apps Portáteis", p, "running", None);
            continue;
        }

        // Optional post_cmd hook after portable extract
        match run_package_hook(app, 2, &portable.name, "post_cmd", &portable.post_cmd, cancel_flag) {
            Ok(()) => {
                success_count += 1;
            }
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(app, "ERR", 2, err);
                failed.portable_apps.push((*portable).clone());
            }
        }

        let p = calc_pct(true);
        emit_progress(app, 2, "Estágio 2: Apps Portáteis", p, "running", None);
    }

    // VS Code Extensions (`code --install-extension <id> --force`)
    if !vscode_exts.is_empty() {
        if let Some(code_bin) = resolve_vscode_cli() {
            emit_log(
                app,
                "INFO",
                2,
                format!(
                    "Instalando {} extensão(ões) do VS Code via {} --install-extension --force...",
                    vscode_exts.len(),
                    code_bin
                ),
            );
            for ext_id in vscode_exts {
                if check_aborted(app, cancel_flag) {
                    emit_abort_finished(app, success_count, failed.total_failures());
                    return;
                }
                emit_progress(
                    app,
                    2,
                    "Estágio 2: Extensões VS Code",
                    calc_pct(false),
                    "running",
                    Some(format!("VS Code: {}", ext_id)),
                );
                match run_command_streaming(
                    app,
                    2,
                    code_bin,
                    &["--install-extension", ext_id, "--force"],
                    cancel_flag,
                ) {
                    Ok(0) => {
                        emit_log(app, "OK", 2, format!("Extensão VS Code instalada: {}", ext_id));
                        success_count += 1;
                    }
                    Ok(code) => {
                        emit_log(
                            app,
                            "ERR",
                            2,
                            format!("Falha ao instalar extensão VS Code '{}' (código {}).", ext_id, code),
                        );
                        failed.vscode_extensions.push(ext_id.clone());
                    }
                    Err(ref e) if e == "ABORTED" => {
                        check_aborted(app, cancel_flag);
                        emit_abort_finished(app, success_count, failed.total_failures());
                        return;
                    }
                    Err(err) => {
                        emit_log(
                            app,
                            "ERR",
                            2,
                            format!("Erro ao instalar extensão '{}': {}", ext_id, err),
                        );
                        failed.vscode_extensions.push(ext_id.clone());
                    }
                }
                let p = calc_pct(true);
                emit_progress(app, 2, "Estágio 2: Extensões VS Code", p, "running", None);
            }
        } else {
            emit_log(
                app,
                "WARN",
                2,
                "VS Code CLI ('code') não encontrado no PATH. Extensões adicionadas ao failed_report.json.",
            );
            for ext_id in vscode_exts {
                failed.vscode_extensions.push(ext_id.clone());
                let _ = calc_pct(true);
            }
        }
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 3 — Restauração do Vault, Wi-Fi, Saves Extras & Dotfiles
    // ------------------------------------------------------------------------
    if check_aborted(app, cancel_flag) {
        emit_abort_finished(app, success_count, failed.total_failures());
        return;
    }

    if let Some(ref bundle_dir) = bundle_dir_opt {
        emit_log(
            app,
            "INFO",
            3,
            format!(
                "Estágio 3A — Restaurando Vault & Perfis Wi-Fi a partir do bundle \"{}\".",
                bundle_dir.display()
            ),
        );

        for item in &enabled_vault {
            if check_aborted(app, cancel_flag) {
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            emit_progress(
                app,
                3,
                "Estágio 3: Restaurando Vault",
                calc_pct(false),
                "running",
                Some(format!("Vault: {}", item.label)),
            );

            let subpath = if item.bundle_subpath.trim().is_empty() {
                format!("vault/{}", sanitize_folder_slug(&item.id, "item"))
            } else {
                item.bundle_subpath.trim().replace('\\', "/")
            };
            let bundle_src = bundle_dir.join(&subpath);
            let target_dst = PathBuf::from(resolve_windows_env_vars(&item.source_path));

            if !bundle_src.exists() {
                emit_log(
                    app,
                    "WARN",
                    3,
                    format!("Vault [{}] não encontrado em \"{}\" — pulando.", item.label, bundle_src.display()),
                );
                let _ = calc_pct(true);
                continue;
            }

            match restore_vault_item(&bundle_src, &target_dst) {
                Ok(count) => {
                    emit_log(
                        app,
                        "OK",
                        3,
                        format!(
                            "Vault [{}] restaurado ({} arquivo(s) -> \"{}\").",
                            item.label,
                            count,
                            target_dst.display()
                        ),
                    );
                    success_count += 1;
                }
                Err(err) => {
                    emit_log(
                        app,
                        "ERR",
                        3,
                        format!("Falha ao restaurar Vault [{}]: {}", item.label, err),
                    );
                    failed.vault_items.push((*item).clone());
                }
            }
            let p = calc_pct(true);
            emit_progress(app, 3, "Estágio 3: Restaurando Vault", p, "running", None);
        }

        // Import Wi-Fi XML profiles from `<bundle_root>/vault/wifi/*.xml`
        let wifi_dir = bundle_dir.join("vault").join("wifi");
        if wifi_dir.exists() {
            if let Ok(entries) = fs::read_dir(&wifi_dir) {
                let xml_files: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| {
                        p.is_file()
                            && p.extension()
                                .and_then(|ext| ext.to_str())
                                .map(|ext| ext.eq_ignore_ascii_case("xml"))
                                .unwrap_or(false)
                    })
                    .collect();

                if !xml_files.is_empty() {
                    emit_log(
                        app,
                        "INFO",
                        3,
                        format!("Importando {} perfil(is) Wi-Fi XML via netsh wlan add profile...", xml_files.len()),
                    );
                }

                for xml_path in xml_files {
                    if check_aborted(app, cancel_flag) {
                        emit_abort_finished(app, success_count, failed.total_failures());
                        return;
                    }
                    let filename_arg = format!("filename={}", xml_path.display());
                    match run_command_streaming(
                        app,
                        3,
                        "netsh",
                        &["wlan", "add", "profile", &filename_arg],
                        cancel_flag,
                    ) {
                        Ok(0) => {
                            emit_log(
                                app,
                                "OK",
                                3,
                                format!(
                                    "Perfil Wi-Fi importado: {}",
                                    xml_path.file_name().unwrap_or_default().to_string_lossy()
                                ),
                            );
                            success_count += 1;
                        }
                        Ok(code) => emit_log(
                            app,
                            "WARN",
                            3,
                            format!(
                                "netsh wlan add profile retornou código {} para {}",
                                code,
                                xml_path.display()
                            ),
                        ),
                        Err(ref e) if e == "ABORTED" => {
                            check_aborted(app, cancel_flag);
                            emit_abort_finished(app, success_count, failed.total_failures());
                            return;
                        }
                        Err(err) => emit_log(
                            app,
                            "WARN",
                            3,
                            format!("Erro ao importar perfil Wi-Fi: {}", err),
                        ),
                    }
                }
            }
        }

        // Restore extra saves if present inside `<bundle_root>/saves/<leaf>`
        let saves_bundle_dir = bundle_dir.join("saves");
        if saves_bundle_dir.exists() && !profile.extra_save_paths.is_empty() {
            for (idx, raw_save) in profile.extra_save_paths.iter().enumerate() {
                let trimmed = raw_save.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let target_save = PathBuf::from(resolve_windows_env_vars(trimmed));
                let leaf = target_save
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| sanitize_folder_slug(n, &format!("save_{}", idx + 1)))
                    .unwrap_or_else(|| format!("save_{}", idx + 1));
                let src_save = saves_bundle_dir.join(&leaf);
                if src_save.exists() {
                    match copy_dir_all(&src_save, &target_save) {
                        Ok(count) => {
                            emit_log(
                                app,
                                "OK",
                                3,
                                format!(
                                    "Save restaurado: saves/{} -> {} ({} arquivos).",
                                    leaf,
                                    target_save.display(),
                                    count
                                ),
                            );
                            success_count += 1;
                        }
                        Err(e) => emit_log(
                            app,
                            "WARN",
                            3,
                            format!("Falha ao restaurar save '{}': {}", leaf, e),
                        ),
                    }
                }
            }
        }

        let p = calc_pct(true);
        emit_progress(app, 3, "Estágio 3: Vault & Wi-Fi concluídos", p, "running", None);
    }

    // Dotfiles & Themes (Git Clone OR Local Bundle Fallback)
    if has_git_dotfiles {
        let temp_repo_dir: PathBuf = env::temp_dir().join("winforge-dotfiles");
        if temp_repo_dir.exists() {
            let _ = fs::remove_dir_all(&temp_repo_dir);
        }

        emit_progress(
            app,
            3,
            "Estágio 3: Dotfiles & Temas",
            calc_pct(false),
            "running",
            Some(format!("Clonando {}", profile.dotfiles.repo_url)),
        );
        emit_log(
            app,
            "INFO",
            3,
            format!(
                "Estágio 3B — Clonando repositório Git {} para {}",
                profile.dotfiles.repo_url,
                temp_repo_dir.display()
            ),
        );

        let temp_repo_str = temp_repo_dir.to_string_lossy().to_string();
        let clone_result = run_command_streaming(
            app,
            3,
            "git",
            &[
                "clone",
                "--depth",
                "1",
                profile.dotfiles.repo_url.trim(),
                &temp_repo_str,
            ],
            cancel_flag,
        );

        match clone_result {
            Ok(0) => {
                emit_log(app, "OK", 3, "Repositório clonado com sucesso.");
                let p = calc_pct(true);
                emit_progress(app, 3, "Estágio 3: Dotfiles & Temas", p, "running", None);

                for mapping in &enabled_mappings {
                    if check_aborted(app, cancel_flag) {
                        let _ = fs::remove_dir_all(&temp_repo_dir);
                        emit_abort_finished(app, success_count, failed.total_failures());
                        return;
                    }

                    emit_progress(
                        app,
                        3,
                        "Estágio 3: Dotfiles & Temas",
                        calc_pct(false),
                        "running",
                        Some(format!("Aplicando dotfile: {}", mapping.label)),
                    );

                    if !mapping.kill_process.trim().is_empty() {
                        kill_process_silent(app, 3, &mapping.kill_process);
                    }

                    let resolved_target = resolve_windows_env_vars(&mapping.target);
                    let target_path = PathBuf::from(&resolved_target);

                    emit_log(
                        app,
                        "INFO",
                        3,
                        format!(
                            "Copiando \"{}\" -> \"{}\"",
                            mapping.source,
                            target_path.display()
                        ),
                    );

                    match apply_dotfile_copy(&temp_repo_dir, &mapping.source, &target_path) {
                        Ok(count) => {
                            emit_log(
                                app,
                                "OK",
                                3,
                                format!(
                                    "Dotfile [{}] aplicado ({} arquivo(s) sincronizado(s)).",
                                    mapping.label, count
                                ),
                            );
                            success_count += 1;
                        }
                        Err(err) => {
                            emit_log(
                                app,
                                "ERR",
                                3,
                                format!("Erro ao copiar dotfile [{}]: {}", mapping.label, err),
                            );
                            failed.dotfiles.push((*mapping).clone());
                        }
                    }

                    let p = calc_pct(true);
                    emit_progress(app, 3, "Estágio 3: Dotfiles & Temas", p, "running", None);
                }
            }
            Ok(code) => {
                emit_log(
                    app,
                    "ERR",
                    3,
                    format!("git clone falhou com código {}. Mapeamentos salvos em failed_report.json.", code),
                );
                for mapping in &enabled_mappings {
                    failed.dotfiles.push((*mapping).clone());
                }
            }
            Err(ref e) if e == "ABORTED" => {
                let _ = fs::remove_dir_all(&temp_repo_dir);
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(
                    app,
                    "ERR",
                    3,
                    format!("Não foi possível executar git clone: {}", err),
                );
                for mapping in &enabled_mappings {
                    failed.dotfiles.push((*mapping).clone());
                }
            }
        }

        if temp_repo_dir.exists() {
            let _ = fs::remove_dir_all(&temp_repo_dir);
        }
    } else if has_bundle_dotfiles {
        if let Some(ref bundle_dir) = bundle_dir_opt {
            let local_dotfiles_root = bundle_dir.join("dotfiles");
            emit_log(
                app,
                "INFO",
                3,
                format!(
                    "Estágio 3B — Restaurando dotfiles offline a partir de \"{}\".",
                    local_dotfiles_root.display()
                ),
            );
            let _ = calc_pct(true);

            for mapping in &enabled_mappings {
                if check_aborted(app, cancel_flag) {
                    emit_abort_finished(app, success_count, failed.total_failures());
                    return;
                }
                if !mapping.kill_process.trim().is_empty() {
                    kill_process_silent(app, 3, &mapping.kill_process);
                }
                let slug = sanitize_folder_slug(&mapping.id, "dotfile");
                let src = local_dotfiles_root.join(&slug);
                let dst = PathBuf::from(resolve_windows_env_vars(&mapping.target));
                match restore_vault_item(&src, &dst) {
                    Ok(count) => {
                        emit_log(
                            app,
                            "OK",
                            3,
                            format!("Dotfile offline [{}] restaurado ({} arquivos).", mapping.label, count),
                        );
                        success_count += 1;
                    }
                    Err(e) => {
                        emit_log(
                            app,
                            "ERR",
                            3,
                            format!("Erro ao restaurar dotfile offline [{}]: {}", mapping.label, e),
                        );
                        failed.dotfiles.push((*mapping).clone());
                    }
                }
                let p = calc_pct(true);
                emit_progress(app, 3, "Estágio 3: Dotfiles Offline", p, "running", None);
            }
        }
    } else {
        emit_log(
            app,
            "INFO",
            3,
            "Estágio 3B — Nenhum repositório Git ou dotfiles offline configurado. Pulando etapa.",
        );
    }

    // ------------------------------------------------------------------------
    // ESTÁGIO 4 — Importação de Registro, Pós-Setup & Relatório de Falhas
    // ------------------------------------------------------------------------
    if check_aborted(app, cancel_flag) {
        emit_abort_finished(app, success_count, failed.total_failures());
        return;
    }

    emit_log(
        app,
        "INFO",
        4,
        format!(
            "Estágio 4 — Importando {} arquivo(s) .reg e finalizando pós-setup.",
            enabled_regs.len()
        ),
    );

    for reg in &enabled_regs {
        if check_aborted(app, cancel_flag) {
            emit_abort_finished(app, success_count, failed.total_failures());
            return;
        }
        emit_progress(
            app,
            4,
            "Estágio 4: Registro & Pós-Setup",
            calc_pct(false),
            "running",
            Some(format!("Importando {}", reg.label)),
        );

        let resolved_reg_path = resolve_windows_env_vars(&reg.path);
        emit_log(app, "INFO", 4, format!("reg.exe import \"{}\"", resolved_reg_path));

        match run_command_streaming(
            app,
            4,
            "reg.exe",
            &["import", &resolved_reg_path],
            cancel_flag,
        ) {
            Ok(0) => {
                emit_log(app, "OK", 4, format!("Registro [{}] importado.", reg.label));
                success_count += 1;
            }
            Ok(code) => {
                emit_log(
                    app,
                    "ERR",
                    4,
                    format!("reg.exe import retornou código {} para \"{}\".", code, resolved_reg_path),
                );
                failed.registry_files.push((*reg).clone());
            }
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(
                    app,
                    "ERR",
                    4,
                    format!("Falha ao importar registro [{}]: {}", reg.label, err),
                );
                failed.registry_files.push((*reg).clone());
            }
        }

        let p = calc_pct(true);
        emit_progress(app, 4, "Estágio 4: Registro & Pós-Setup", p, "running", None);
    }

    // Autostart Elevado (Task Scheduler via `schtasks /create /sc onlogon`)
    if !enabled_autostarts.is_empty() {
        emit_log(
            app,
            "INFO",
            4,
            format!(
                "Estágio 4B — Registrando {} tarefa(s) de inicialização no Agendador de Tarefas (schtasks)...",
                enabled_autostarts.len()
            ),
        );
    }
    for task in &enabled_autostarts {
        if check_aborted(app, cancel_flag) {
            emit_abort_finished(app, success_count, failed.total_failures());
            return;
        }
        emit_progress(
            app,
            4,
            "Estágio 4: Autostart (schtasks)",
            calc_pct(false),
            "running",
            Some(format!("Autostart: {}", task.name)),
        );

        match deploy_autostart_task(app, 4, task, cancel_flag) {
            Ok(()) => {
                emit_log(
                    app,
                    "OK",
                    4,
                    format!(
                        "Autostart [{}] registrado no logon{}.",
                        task.name,
                        if task.run_as_admin { " (Elevado /rl highest)" } else { "" }
                    ),
                );
                success_count += 1;
            }
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                emit_abort_finished(app, success_count, failed.total_failures());
                return;
            }
            Err(err) => {
                emit_log(
                    app,
                    "ERR",
                    4,
                    format!("Falha ao criar tarefa Autostart [{}]: {}", task.name, err),
                );
                failed.autostart_tasks.push((*task).clone());
            }
        }

        let p = calc_pct(true);
        emit_progress(app, 4, "Estágio 4: Autostart (schtasks)", p, "running", None);
    }

    let needs_explorer_restart =
        !enabled_tweaks.is_empty() || !enabled_regs.is_empty() || has_dotfiles;

    if needs_explorer_restart && !check_aborted(app, cancel_flag) {
        emit_log(
            app,
            "WARN",
            4,
            "Reiniciando explorer.exe para aplicar tweaks visuais e registros...",
        );
        kill_process_silent(app, 4, "explorer");
        match Command::new("explorer.exe").spawn() {
            Ok(_) => emit_log(app, "OK", 4, "explorer.exe reiniciado com sucesso."),
            Err(e) => emit_log(
                app,
                "WARN",
                4,
                format!("Não foi possível reiniciar explorer.exe automaticamente: {}", e),
            ),
        }
    }

    // Generate `failed_report.json` if any step failed during real execution
    let failure_count = failed.total_failures();
    let (failed_report_path, failed_profile) = if failure_count > 0 {
        let sub_profile = failed.into_sub_profile(profile);
        let report_path = bundle_dir_opt
            .as_ref()
            .map(|b| b.join("failed_report.json"))
            .unwrap_or_else(|| PathBuf::from("failed_report.json"));

        match serde_json::to_string_pretty(&sub_profile)
            .map_err(|e| e.to_string())
            .and_then(|json| fs::write(&report_path, json).map_err(|e| e.to_string()))
        {
            Ok(()) => {
                let path_str = report_path.to_string_lossy().to_string();
                emit_log(
                    app,
                    "WARN",
                    4,
                    format!(
                        "{} falha(s) registrada(s). Sub-perfil de recuperação salvo em \"{}\".",
                        failure_count, path_str
                    ),
                );
                (Some(path_str), Some(sub_profile))
            }
            Err(e) => {
                emit_log(
                    app,
                    "ERR",
                    4,
                    format!("Falha ao gravar failed_report.json: {}", e),
                );
                (None, Some(sub_profile))
            }
        }
    } else {
        (None, None)
    };

    emit_log(
        app,
        if failure_count == 0 { "OK" } else { "WARN" },
        4,
        format!(
            "Provisionamento finalizado: {} sucesso(s), {} falha(s).",
            success_count, failure_count
        ),
    );
    emit_progress(
        app,
        4,
        if failure_count == 0 {
            "Provisionamento Concluído"
        } else {
            "Concluído com Falhas"
        },
        100,
        "completed",
        Some(format!("{} OK · {} falhas", success_count, failure_count)),
    );
    emit_finished(
        app,
        ProvisionFinishedPayload {
            dry_run: false,
            status: "completed".to_string(),
            success_count,
            failure_count,
            failed_report_path,
            failed_profile,
        },
    );
}

// ============================================================================
// 7. Reverse Snapshot — Capture Current System (`scan_current_system`)
// ============================================================================

#[derive(Debug, Deserialize)]
struct WingetExportManifest {
    #[serde(rename = "Sources", default)]
    sources: Vec<WingetExportSource>,
}

#[derive(Debug, Deserialize)]
struct WingetExportSource {
    #[serde(rename = "Packages", default)]
    packages: Vec<WingetExportPackage>,
}

#[derive(Debug, Deserialize)]
struct WingetExportPackage {
    #[serde(rename = "PackageIdentifier")]
    package_identifier: String,
}

fn infer_package_name(pkg_id: &str) -> String {
    pkg_id
        .split('.')
        .last()
        .unwrap_or(pkg_id)
        .replace(['-', '_'], " ")
}

fn infer_package_category(pkg_id: &str) -> String {
    let lower = pkg_id.to_ascii_lowercase();
    if lower.contains("steam")
        || lower.contains("epic")
        || lower.contains("discord")
        || lower.contains("playnite")
        || lower.contains("ubisoft")
        || lower.contains("ea.")
        || lower.contains("gog")
        || lower.contains("nvidia")
    {
        "Gaming".to_string()
    } else if lower.contains("vscode")
        || lower.contains("visualstudiocode")
        || lower.contains("git.")
        || lower.contains("rust")
        || lower.contains("python")
        || lower.contains("nodejs")
        || lower.contains("docker")
        || lower.contains("terminal")
        || lower.contains("neovim")
        || lower.contains("jetbrains")
        || lower.contains("zoxide")
        || lower.contains("fastfetch")
        || lower.contains("starship")
    {
        "Dev & Terminal".to_string()
    } else if lower.contains("firefox")
        || lower.contains("chrome")
        || lower.contains("brave")
        || lower.contains("zen-browser")
        || lower.contains("vivaldi")
        || lower.contains("arc")
    {
        "Navegadores".to_string()
    } else if lower.contains("spotify")
        || lower.contains("vlc")
        || lower.contains("obsproject")
        || lower.contains("mpv")
        || lower.contains("ffmpeg")
    {
        "Mídia".to_string()
    } else if lower.contains("obsidian")
        || lower.contains("notion")
        || lower.contains("powertoys")
        || lower.contains("flow-launcher")
        || lower.contains("glazewm")
        || lower.contains("yasb")
    {
        "Produtividade".to_string()
    } else {
        "Utilitários".to_string()
    }
}

fn scan_known_dotfile_folders(app: &EventSink) -> Vec<DotfileMapping> {
    let candidates: &[(&str, &str, &str, &str, &str)] = &[
        (
            "flow_launcher",
            "Flow Launcher Config",
            "flow-launcher/*",
            "%APPDATA%\\FlowLauncher",
            "Flow.Launcher",
        ),
        (
            "yasb",
            "YASB Status Bar",
            "yasb/*",
            "%USERPROFILE%\\.config\\yasb",
            "yasb",
        ),
        (
            "fastfetch",
            "Fastfetch Config",
            "fastfetch/*",
            "%USERPROFILE%\\.config\\fastfetch",
            "",
        ),
        (
            "glazewm",
            "GlazeWM Tiling Config",
            "glazewm/*",
            "%USERPROFILE%\\.glzr\\glazewm",
            "glazewm",
        ),
        (
            "windows_terminal",
            "Windows Terminal State",
            "terminal/*",
            "%LOCALAPPDATA%\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState",
            "WindowsTerminal",
        ),
        (
            "wezterm",
            "WezTerm Config",
            "wezterm/*",
            "%USERPROFILE%\\.config\\wezterm",
            "wezterm-gui",
        ),
        (
            "vscode_user",
            "VS Code User Settings",
            "vscode/*",
            "%APPDATA%\\Code\\User",
            "Code",
        ),
    ];

    let mut discovered = Vec::new();
    for &(id, label, source, raw_target, kill_proc) in candidates {
        let resolved = resolve_windows_env_vars(raw_target);
        let path = PathBuf::from(&resolved);
        if path.exists() {
            emit_log(
                app,
                "OK",
                3,
                format!("Pasta de configuração detectada: {} ({})", raw_target, resolved),
            );
            discovered.push(DotfileMapping {
                id: id.to_string(),
                label: label.to_string(),
                source: source.to_string(),
                target: raw_target.to_string(),
                kill_process: kill_proc.to_string(),
                enabled: true,
            });
        } else {
            emit_log(
                app,
                "INFO",
                3,
                format!("Não encontrada (ignorada): {}", raw_target),
            );
        }
    }

    discovered
}

#[derive(Debug, Deserialize)]
struct RawStartupShortcut {
    #[serde(default)]
    name: String,
    #[serde(default)]
    exe_path: String,
    #[serde(default)]
    args: String,
    #[serde(default)]
    run_as_admin: bool,
}

/// Scans `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` and resolves `.lnk`
/// shortcuts (via WScript.Shell + `.lnk` SLDF_RUNAS_USER flag) plus direct executable/script
/// entries to suggest `autostart_tasks`.
fn scan_startup_shortcuts(app: &EventSink) -> Vec<AutostartTask> {
    let raw_startup_dir = "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup";
    let resolved_dir = resolve_windows_env_vars(raw_startup_dir);
    let startup_path = PathBuf::from(&resolved_dir);

    if !startup_path.exists() {
        emit_log(
            app,
            "INFO",
            4,
            format!("Pasta Startup não encontrada em \"{}\" — pulando leitura de atalhos.", resolved_dir),
        );
        return Vec::new();
    }

    emit_log(
        app,
        "INFO",
        4,
        format!("Lendo atalhos de inicialização em \"{}\"...", resolved_dir),
    );

    let ps_cmd = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $dir = '{}'; $sh = New-Object -ComObject WScript.Shell; $items = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | ForEach-Object {{ if ($_.Extension -ieq '.lnk') {{ try {{ $sc = $sh.CreateShortcut($_.FullName); if ($sc.TargetPath) {{ $isAdmin = $false; try {{ $b = [System.IO.File]::ReadAllBytes($_.FullName); if ($b.Length -gt 21) {{ $isAdmin = (($b[21] -band 0x20) -ne 0) }} }} catch {{}}; [PSCustomObject]@{{ name = $_.BaseName; exe_path = [string]$sc.TargetPath; args = [string]$sc.Arguments; run_as_admin = $isAdmin }} }} }} catch {{}} }} elseif ($_.Extension -imatch '^\\.(exe|bat|cmd|ps1)$') {{ [PSCustomObject]@{{ name = $_.BaseName; exe_path = $_.FullName; args = ''; run_as_admin = $false }} }} }}); if ($items.Count -gt 0) {{ $items | ConvertTo-Json -Compress }}",
        ps_single_quote(&resolved_dir)
    );

    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &ps_cmd,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    apply_no_window(&mut cmd);

    let mut suggested: Vec<AutostartTask> = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();

    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout)
                .trim_start_matches('\u{feff}')
                .trim()
                .to_string();
            if !stdout.is_empty() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    let raw_list: Vec<RawStartupShortcut> = match val {
                        serde_json::Value::Array(arr) => arr
                            .into_iter()
                            .filter_map(|v| serde_json::from_value(v).ok())
                            .collect(),
                        serde_json::Value::Object(_) => serde_json::from_value(val)
                            .map(|item| vec![item])
                            .unwrap_or_default(),
                        _ => Vec::new(),
                    };

                    for entry in raw_list {
                        let name = entry.name.trim().to_string();
                        let exe_path = entry.exe_path.trim().to_string();
                        let args = entry.args.trim().to_string();
                        if !name.is_empty()
                            && !exe_path.is_empty()
                            && seen_keys.insert(exe_path.to_ascii_lowercase())
                        {
                            suggested.push(AutostartTask {
                                name,
                                exe_path,
                                args,
                                run_as_admin: entry.run_as_admin,
                                enabled: true,
                            });
                        }
                    }
                }
            }
        }
    }

    if !suggested.is_empty() {
        emit_log(
            app,
            "OK",
            4,
            format!(
                "{} item(ns) sugerido(s) a partir da pasta Startup para autostart_tasks.",
                suggested.len()
            ),
        );
    } else {
        emit_log(
            app,
            "INFO",
            4,
            "Nenhum atalho de inicialização encontrado na pasta Startup.",
        );
    }

    suggested
}

/// Standalone Tauri command to scan `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
/// and return suggested `AutostartTask` entries on demand.
#[tauri::command]
async fn scan_startup_tasks(app: AppHandle) -> Result<Vec<AutostartTask>, String> {
    let sink = EventSink::Tauri(app);
    tauri::async_runtime::spawn_blocking(move || scan_startup_shortcuts(&sink))
        .await
        .map_err(|e| format!("Falha ao escanear pasta Startup: {}", e))
}

/// Standalone Tauri command to schedule enabled `autostart_tasks` immediately via
/// `schtasks /create /sc onlogon` (respecting `run_as_admin` -> `/rl highest`).
#[tauri::command]
async fn deploy_autostart_tasks(
    app: AppHandle,
    tasks: Vec<AutostartTask>,
) -> Result<usize, String> {
    let sink = EventSink::Tauri(app);
    let cancel_flag = Arc::new(AtomicBool::new(false));

    tauri::async_runtime::spawn_blocking(move || {
        let enabled: Vec<AutostartTask> = tasks.into_iter().filter(|t| t.enabled).collect();
        if enabled.is_empty() {
            emit_log(&sink, "WARN", 4, "Nenhuma tarefa Autostart ativa selecionada para agendamento.");
            return Ok(0);
        }

        let mut scheduled = 0usize;
        let mut errors = 0usize;

        for task in &enabled {
            match deploy_autostart_task(&sink, 4, task, &cancel_flag) {
                Ok(()) => {
                    scheduled += 1;
                    emit_log(
                        &sink,
                        "OK",
                        4,
                        format!(
                            "Autostart [{}] agendado no logon{}.",
                            task.name,
                            if task.run_as_admin { " (/rl highest)" } else { "" }
                        ),
                    );
                }
                Err(err) => {
                    errors += 1;
                    emit_log(
                        &sink,
                        "ERR",
                        4,
                        format!("Falha ao agendar Autostart [{}]: {}", task.name, err),
                    );
                }
            }
        }

        if errors > 0 && scheduled == 0 {
            Err(format!("Falha ao agendar {} tarefa(s) via schtasks.", errors))
        } else {
            Ok(scheduled)
        }
    })
    .await
    .map_err(|e| format!("Erro interno em deploy_autostart_tasks: {}", e))?
}

#[tauri::command]
async fn scan_current_system(app: AppHandle) -> Result<ProfileConfig, String> {
    let sink = EventSink::Tauri(app);

    tauri::async_runtime::spawn_blocking(move || {
        emit_log(
            &sink,
            "INFO",
            0,
            "Iniciando Reverse Snapshot — capturando pacotes WinGet e diretórios de configuração locais...",
        );

        let temp_export_path = env::temp_dir().join("temp_packages.json");
        if temp_export_path.exists() {
            let _ = fs::remove_file(&temp_export_path);
        }
        let temp_export_str = temp_export_path.to_string_lossy().to_string();

        emit_log(
            &sink,
            "INFO",
            2,
            format!("Executando: winget export -o \"{}\" --accept-source-agreements", temp_export_str),
        );

        let mut cmd = Command::new("winget");
        cmd.args([
            "export",
            "-o",
            &temp_export_str,
            "--accept-source-agreements",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        apply_no_window(&mut cmd);

        let mut captured_packages: Vec<WingetPackage> = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        match cmd.output() {
            Ok(output) => {
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    emit_log(
                        &sink,
                        "WARN",
                        2,
                        format!(
                            "winget export finalizou com aviso ({}): {}",
                            output.status.code().unwrap_or(-1),
                            stderr.trim()
                        ),
                    );
                }

                if temp_export_path.exists() {
                    match fs::read_to_string(&temp_export_path) {
                        Ok(raw_json) => match serde_json::from_str::<WingetExportManifest>(&raw_json) {
                            Ok(manifest) => {
                                for source in manifest.sources {
                                    for pkg in source.packages {
                                        let id = pkg.package_identifier.trim().to_string();
                                        if !id.is_empty() && seen_ids.insert(id.to_ascii_lowercase()) {
                                            captured_packages.push(WingetPackage {
                                                name: infer_package_name(&id),
                                                category: infer_package_category(&id),
                                                id,
                                                enabled: true,
                                                pre_cmd: None,
                                                post_cmd: None,
                                            });
                                        }
                                    }
                                }
                                emit_log(
                                    &sink,
                                    "OK",
                                    2,
                                    format!(
                                        "{} pacote(s) WinGet extraídos de temp_packages.json.",
                                        captured_packages.len()
                                    ),
                                );
                            }
                            Err(e) => {
                                let _ = fs::remove_file(&temp_export_path);
                                return Err(format!("Falha ao interpretar temp_packages.json: {}", e));
                            }
                        },
                        Err(e) => {
                            let _ = fs::remove_file(&temp_export_path);
                            return Err(format!("Falha ao ler temp_packages.json: {}", e));
                        }
                    }
                    let _ = fs::remove_file(&temp_export_path);
                } else {
                    emit_log(
                        &sink,
                        "WARN",
                        2,
                        "Arquivo temp_packages.json não foi gerado pelo WinGet.",
                    );
                }
            }
            Err(e) => {
                emit_log(
                    &sink,
                    "ERR",
                    2,
                    format!("Falha ao executar winget export: {}", e),
                );
                return Err(format!("Não foi possível executar winget export: {}", e));
            }
        }

        emit_log(
            &sink,
            "INFO",
            3,
            "Verificando diretórios de configuração conhecidos (%APPDATA%, %USERPROFILE%, %LOCALAPPDATA%)...",
        );
        let discovered_mappings = scan_known_dotfile_folders(&sink);
        let suggested_autostarts = scan_startup_shortcuts(&sink);

        let computer_name = env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".to_string());
        let user_name = env::var("USERNAME").unwrap_or_else(|_| "User".to_string());
        let date_stamp = Local::now().format("%Y-%m-%d").to_string();

        let snapshot = ProfileConfig {
            profile_name: format!("Snapshot {} ({})", computer_name, date_stamp),
            author: user_name,
            create_restore_point: true,
            system_tweaks: vec![
                SystemTweak {
                    id: "show_ext".to_string(),
                    label: "Mostrar extensões de arquivos no Explorer".to_string(),
                    enabled: true,
                    command: "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced' -Name 'HideFileExt' -Value 0".to_string(),
                },
                SystemTweak {
                    id: "dark_mode".to_string(),
                    label: "Ativar Modo Escuro global (Apps & Sistema)".to_string(),
                    enabled: true,
                    command: "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'AppsUseLightTheme' -Value 0; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name 'SystemUsesLightTheme' -Value 0".to_string(),
                },
            ],
            external_scripts: vec![],
            winget_packages: captured_packages,
            dotfiles: DotfilesConfig {
                repo_url: String::new(),
                mappings: discovered_mappings,
            },
            registry_files: vec![],
            bundle_root: Some("./WinForge_Bundle".to_string()),
            vault_items: default_vault_items(),
            vscode_extensions: capture_vscode_extensions(&sink),
            portable_apps: vec![],
            backup_wifi: false,
            backup_drivers: false,
            extra_save_paths: vec![],
            autostart_tasks: suggested_autostarts,
            key_remaps: vec![],
        };

        emit_log(
            &sink,
            "OK",
            0,
            format!(
                "Reverse Snapshot concluído: {} pacotes, {} dotfiles e {} item(ns) Startup capturados. Use 'Exportar JSON' para salvar o backup.",
                snapshot.winget_packages.len(),
                snapshot.dotfiles.mappings.len(),
                snapshot.autostart_tasks.len()
            ),
        );

        Ok(snapshot)
    })
    .await
    .map_err(|e| format!("Falha interna na thread de snapshot: {}", e))?
}

// ============================================================================
// 8. HARVEST Mode — Pre-Format Bundle Snapshot (`run_harvest`)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HarvestOptions {
    #[serde(default)]
    pub profile: Option<ProfileConfig>,
    #[serde(default)]
    pub backup_wifi: bool,
    #[serde(default)]
    pub backup_drivers: bool,
    #[serde(default = "default_true")]
    pub capture_vscode_extensions: bool,
    #[serde(default = "default_true")]
    pub detect_non_winget_apps: bool,
    #[serde(default)]
    pub vault_items: Vec<VaultItem>,
    #[serde(default)]
    pub dotfile_mappings: Vec<DotfileMapping>,
    #[serde(default)]
    pub extra_save_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualAppEntry {
    pub display_name: String,
    pub display_version: String,
    pub publisher: String,
    pub source_hive: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarvestResult {
    pub output_dir: String,
    pub profile_path: String,
    pub manual_report_path: String,
    pub manual_report_markdown: String,
    pub manual_apps_count: usize,
    pub vscode_extensions_count: usize,
    pub copied_vault_files: usize,
    pub copied_dotfile_files: usize,
    pub copied_save_files: usize,
    pub profile: ProfileConfig,
}

fn default_vault_items() -> Vec<VaultItem> {
    vec![
        VaultItem {
            id: "ssh_keys".to_string(),
            label: "Chaves SSH (~/.ssh)".to_string(),
            source_path: "%USERPROFILE%\\.ssh".to_string(),
            bundle_subpath: "vault/ssh".to_string(),
            enabled: true,
        },
        VaultItem {
            id: "gitconfig".to_string(),
            label: "Git Config (~/.gitconfig)".to_string(),
            source_path: "%USERPROFILE%\\.gitconfig".to_string(),
            bundle_subpath: "vault/gitconfig".to_string(),
            enabled: true,
        },
        VaultItem {
            id: "npmrc".to_string(),
            label: "NPM Config (~/.npmrc)".to_string(),
            source_path: "%USERPROFILE%\\.npmrc".to_string(),
            bundle_subpath: "vault/npmrc".to_string(),
            enabled: true,
        },
        VaultItem {
            id: "windows_terminal".to_string(),
            label: "Windows Terminal Settings".to_string(),
            source_path: "%LOCALAPPDATA%\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json".to_string(),
            bundle_subpath: "vault/windows-terminal".to_string(),
            enabled: true,
        },
        VaultItem {
            id: "obs_studio".to_string(),
            label: "OBS Studio Config & Scenes".to_string(),
            source_path: "%APPDATA%\\obs-studio\\basic".to_string(),
            bundle_subpath: "vault/obs-studio".to_string(),
            enabled: false,
        },
    ]
}

/// Copies a single file or recursively copies a directory into `dst_dir`.
fn copy_path_into_bundle(src: &Path, dst_dir: &Path) -> std::io::Result<usize> {
    if !src.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Origem não encontrada: {}", src.display()),
        ));
    }

    if src.is_dir() {
        copy_dir_all(src, dst_dir)
    } else {
        fs::create_dir_all(dst_dir)?;
        let file_name = src.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "Nome de arquivo inválido")
        })?;
        fs::copy(src, dst_dir.join(file_name))?;
        Ok(1)
    }
}

/// Executes `code --list-extensions` (trying `code.cmd` on Windows) silently and returns extension IDs.
fn capture_vscode_extensions(app: &EventSink) -> Vec<String> {
    let candidates = if cfg!(target_os = "windows") {
        vec!["code.cmd", "code"]
    } else {
        vec!["code"]
    };

    for bin in candidates {
        let mut cmd = Command::new(bin);
        cmd.arg("--list-extensions")
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        apply_no_window(&mut cmd);

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut exts: Vec<String> = stdout
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty() && l.contains('.'))
                    .collect();
                exts.sort();
                exts.dedup();
                emit_log(
                    app,
                    "OK",
                    2,
                    format!("VS Code detectado: {} extensão(ões) capturada(s).", exts.len()),
                );
                return exts;
            }
        }
    }

    emit_log(
        app,
        "WARN",
        2,
        "VS Code CLI ('code --list-extensions') não encontrado no PATH. Pulando extensões.",
    );
    Vec::new()
}

/// Reads installed programs from HKLM (64-bit & WOW6432Node) and HKCU Uninstall registry keys.
fn read_installed_registry_apps() -> Vec<ManualAppEntry> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::HashSet;
        use winreg::enums::*;
        use winreg::RegKey;

        let hives: &[(&str, winreg::HKEY, &str)] = &[
            (
                "HKLM (64-bit)",
                HKEY_LOCAL_MACHINE,
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            ),
            (
                "HKLM (32-bit WOW6432Node)",
                HKEY_LOCAL_MACHINE,
                "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            ),
            (
                "HKCU (User)",
                HKEY_CURRENT_USER,
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            ),
        ];

        let mut results = Vec::new();
        let mut seen_names: HashSet<String> = HashSet::new();

        for &(hive_label, hkey, subkey_path) in hives {
            let root = RegKey::predef(hkey);
            if let Ok(uninstall_key) = root.open_subkey(subkey_path) {
                for subkey_name in uninstall_key.enum_keys().flatten() {
                    if let Ok(app_key) = uninstall_key.open_subkey(&subkey_name) {
                        // Skip hidden system components and Windows KB patches
                        let sys_component: u32 = app_key.get_value("SystemComponent").unwrap_or(0);
                        if sys_component == 1 {
                            continue;
                        }
                        if app_key.get_value::<String, _>("ParentKeyName").is_ok() {
                            continue;
                        }

                        let display_name: String = app_key
                            .get_value("DisplayName")
                            .unwrap_or_default();
                        let clean_name = display_name.trim().to_string();
                        if clean_name.is_empty() {
                            continue;
                        }

                        let dedup_key = clean_name.to_ascii_lowercase();
                        if !seen_names.insert(dedup_key) {
                            continue;
                        }

                        let display_version: String = app_key
                            .get_value("DisplayVersion")
                            .unwrap_or_else(|_| "—".to_string());
                        let publisher: String = app_key
                            .get_value("Publisher")
                            .unwrap_or_else(|_| "Desconhecido".to_string());

                        results.push(ManualAppEntry {
                            display_name: clean_name,
                            display_version: display_version.trim().to_string(),
                            publisher: publisher.trim().to_string(),
                            source_hive: hive_label.to_string(),
                        });
                    }
                }
            }
        }

        results.sort_by(|a, b| {
            a.display_name
                .to_ascii_lowercase()
                .cmp(&b.display_name.to_ascii_lowercase())
        });
        results
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

fn normalize_match_token(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Cross-references Windows Uninstall Registry apps against WinGet exported package IDs.
fn find_non_winget_apps(
    registry_apps: &[ManualAppEntry],
    winget_ids: &[String],
) -> Vec<ManualAppEntry> {
    let normalized_winget: Vec<(String, Vec<String>)> = winget_ids
        .iter()
        .map(|id| {
            let full = normalize_match_token(id);
            let parts: Vec<String> = id
                .split('.')
                .map(normalize_match_token)
                .filter(|p| p.len() >= 3)
                .collect();
            (full, parts)
        })
        .collect();

    registry_apps
        .iter()
        .filter(|app| {
            let norm_name = normalize_match_token(&app.display_name);
            let norm_pub = normalize_match_token(&app.publisher);
            if norm_name.is_empty() {
                return false;
            }

            let matched = normalized_winget.iter().any(|(full_id, parts)| {
                if !full_id.is_empty() && (norm_name.contains(full_id) || full_id.contains(&norm_name)) {
                    return true;
                }
                // Match if the leaf segment (product name) appears in DisplayName
                if let Some(last_part) = parts.last() {
                    if last_part.len() >= 4 && norm_name.contains(last_part) {
                        if parts.len() == 1 || norm_pub.is_empty() {
                            return true;
                        }
                        if let Some(pub_part) = parts.first() {
                            if norm_pub.contains(pub_part) || norm_name.contains(pub_part) {
                                return true;
                            }
                        }
                        // Strong single-word brand matches (e.g. Steam, Discord, Obsidian, Spotify)
                        if last_part.len() >= 5 {
                            return true;
                        }
                    }
                }
                false
            });

            !matched
        })
        .cloned()
        .collect()
}

fn build_manual_apps_markdown(
    manual_apps: &[ManualAppEntry],
    total_registry_apps: usize,
    total_winget_apps: usize,
) -> String {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let mut md = String::new();
    md.push_str("# WinForge — Relatório de Apps Fora do WinGet\n\n");
    md.push_str(&format!("- **Gerado em:** {}\n", timestamp));
    md.push_str(&format!("- **Apps detectados no Registro (HKLM/HKCU):** {}\n", total_registry_apps));
    md.push_str(&format!("- **Pacotes capturados no WinGet:** {}\n", total_winget_apps));
    md.push_str(&format!("- **Apps que exigem atenção/instalação manual:** {}\n\n", manual_apps.len()));

    if manual_apps.is_empty() {
        md.push_str("Todos os aplicativos detectados no Registro foram encontrados no catálogo WinGet.\n");
        return md;
    }

    md.push_str("| Aplicativo | Versão | Publicador | Origem no Registro |\n");
    md.push_str("| --- | --- | --- | --- |\n");
    for app in manual_apps {
        let name = app.display_name.replace('|', "\\|");
        let ver = app.display_version.replace('|', "\\|");
        let pub_str = app.publisher.replace('|', "\\|");
        md.push_str(&format!(
            "| {} | {} | {} | {} |\n",
            name, ver, pub_str, app.source_hive
        ));
    }

    md.push_str("\n> Dica: Você pode adicionar apps portáteis (.zip) diretamente em `portable_apps` no `profile.json`.\n");
    md
}

fn export_winget_package_ids(app: &EventSink) -> Vec<WingetPackage> {
    let temp_export_path = env::temp_dir().join("temp_packages.json");
    if temp_export_path.exists() {
        let _ = fs::remove_file(&temp_export_path);
    }
    let temp_export_str = temp_export_path.to_string_lossy().to_string();

    emit_log(
        app,
        "INFO",
        2,
        format!("Executando: winget export -o \"{}\" --accept-source-agreements", temp_export_str),
    );

    let mut cmd = Command::new("winget");
    cmd.args([
        "export",
        "-o",
        &temp_export_str,
        "--accept-source-agreements",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let mut packages = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Ok(output) = cmd.output() {
        if !output.status.success() {
            emit_log(
                app,
                "WARN",
                2,
                format!(
                    "winget export retornou código {} (alguns pacotes podem não ter fonte WinGet).",
                    output.status.code().unwrap_or(-1)
                ),
            );
        }

        if temp_export_path.exists() {
            if let Ok(raw_json) = fs::read_to_string(&temp_export_path) {
                if let Ok(manifest) = serde_json::from_str::<WingetExportManifest>(&raw_json) {
                    for source in manifest.sources {
                        for pkg in source.packages {
                            let id = pkg.package_identifier.trim().to_string();
                            if !id.is_empty() && seen.insert(id.to_ascii_lowercase()) {
                                packages.push(WingetPackage {
                                    name: infer_package_name(&id),
                                    category: infer_package_category(&id),
                                    id,
                                    enabled: true,
                                    pre_cmd: None,
                                    post_cmd: None,
                                });
                            }
                        }
                    }
                }
            }
            let _ = fs::remove_file(&temp_export_path);
        }
    } else {
        emit_log(
            app,
            "WARN",
            2,
            "WinGet indisponível durante o HARVEST. O cruzamento de apps manuais usará os pacotes do perfil.",
        );
    }

    packages
}

fn sanitize_folder_slug(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
async fn run_harvest(
    app: AppHandle,
    state: State<'_, ProvisionState>,
    output_dir: String,
    options: HarvestOptions,
) -> Result<HarvestResult, String> {
    if state.is_running.swap(true, Ordering::SeqCst) {
        return Err("Já existe uma operação de provisionamento ou HARVEST em andamento.".to_string());
    }
    state.cancel_flag.store(false, Ordering::SeqCst);

    let is_running = Arc::clone(&state.is_running);
    let cancel_flag = Arc::clone(&state.cancel_flag);
    let sink = EventSink::Tauri(app);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let res = execute_harvest_pipeline(&sink, &output_dir, &options, &cancel_flag);
        is_running.store(false, Ordering::SeqCst);
        cancel_flag.store(false, Ordering::SeqCst);
        res
    })
    .await
    .map_err(|e| format!("Falha interna na thread de HARVEST: {}", e))?;

    result
}

fn execute_harvest_pipeline(
    app: &EventSink,
    output_dir: &str,
    options: &HarvestOptions,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<HarvestResult, String> {
    let resolved_output = resolve_windows_env_vars(output_dir.trim());
    if resolved_output.is_empty() {
        return Err("Diretório de saída (output_dir) não pode estar vazio.".to_string());
    }
    let bundle_root = PathBuf::from(&resolved_output);

    emit_progress(
        app,
        0,
        "HARVEST: Criando estrutura do Bundle",
        5,
        "running",
        Some(format!("Preparando {}", bundle_root.display())),
    );
    emit_log(
        app,
        "INFO",
        0,
        format!(
            "Iniciando modo HARVEST (Snapshot Pré-Formatação) em \"{}\"",
            bundle_root.display()
        ),
    );

    // 1. Create bundle folder tree: vault/, dotfiles/, drivers/, saves/
    let vault_dir = bundle_root.join("vault");
    let dotfiles_dir = bundle_root.join("dotfiles");
    let drivers_dir = bundle_root.join("drivers");
    let saves_dir = bundle_root.join("saves");

    for dir in [&bundle_root, &vault_dir, &dotfiles_dir, &drivers_dir, &saves_dir] {
        fs::create_dir_all(dir)
            .map_err(|e| format!("Falha ao criar pasta '{}': {}", dir.display(), e))?;
    }
    emit_log(
        app,
        "OK",
        0,
        "Estrutura criada: vault/, dotfiles/, drivers/ e saves/.",
    );

    if check_aborted(app, cancel_flag) {
        return Err("HARVEST abortado pelo usuário.".to_string());
    }

    // Prepare base profile from options or defaults
    let computer_name = env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".to_string());
    let user_name = env::var("USERNAME").unwrap_or_else(|_| "User".to_string());
    let date_stamp = Local::now().format("%Y-%m-%d").to_string();

    let mut profile = options.profile.clone().unwrap_or_else(|| ProfileConfig {
        profile_name: format!("Harvest {} ({})", computer_name, date_stamp),
        author: user_name,
        create_restore_point: true,
        system_tweaks: vec![],
        external_scripts: vec![],
        winget_packages: vec![],
        dotfiles: DotfilesConfig::default(),
        registry_files: vec![],
        bundle_root: Some("./WinForge_Bundle".to_string()),
        vault_items: default_vault_items(),
        vscode_extensions: vec![],
        portable_apps: vec![],
        backup_wifi: options.backup_wifi,
        backup_drivers: options.backup_drivers,
        extra_save_paths: options.extra_save_paths.clone(),
        autostart_tasks: vec![],
        key_remaps: vec![],
    });

    if !options.vault_items.is_empty() {
        profile.vault_items = options.vault_items.clone();
    } else if profile.vault_items.is_empty() {
        profile.vault_items = default_vault_items();
    }

    if !options.dotfile_mappings.is_empty() {
        profile.dotfiles.mappings = options.dotfile_mappings.clone();
    }

    if !options.extra_save_paths.is_empty() {
        profile.extra_save_paths = options.extra_save_paths.clone();
    }

    let do_backup_wifi = options.backup_wifi || profile.backup_wifi;
    let do_backup_drivers = options.backup_drivers || profile.backup_drivers;
    profile.backup_wifi = do_backup_wifi;
    profile.backup_drivers = do_backup_drivers;
    profile.bundle_root = Some(output_dir.trim().to_string());

    // 2. Copy Vault items (.ssh, .gitconfig, .npmrc, Windows Terminal, OBS, etc.)
    emit_progress(
        app,
        1,
        "HARVEST: Copiando Vault (Credenciais & Configs)",
        20,
        "running",
        Some("Copiando itens do Vault".to_string()),
    );
    let mut copied_vault_files = 0usize;
    for item in profile.vault_items.iter().filter(|v| v.enabled) {
        if check_aborted(app, cancel_flag) {
            return Err("HARVEST abortado pelo usuário.".to_string());
        }
        let resolved_src = resolve_windows_env_vars(&item.source_path);
        let src_path = PathBuf::from(&resolved_src);
        let subpath = if item.bundle_subpath.trim().is_empty() {
            format!("vault/{}", sanitize_folder_slug(&item.id, "item"))
        } else {
            item.bundle_subpath.trim().replace('\\', "/")
        };
        let dst_path = bundle_root.join(&subpath);

        if !src_path.exists() {
            emit_log(
                app,
                "WARN",
                1,
                format!("Vault [{}] não encontrado em \"{}\" — pulando.", item.label, resolved_src),
            );
            continue;
        }

        match copy_path_into_bundle(&src_path, &dst_path) {
            Ok(count) => {
                copied_vault_files += count;
                emit_log(
                    app,
                    "OK",
                    1,
                    format!(
                        "Vault [{}] copiado: {} arquivo(s) -> {}",
                        item.label, count, subpath
                    ),
                );
            }
            Err(e) => emit_log(
                app,
                "ERR",
                1,
                format!("Falha ao copiar Vault [{}]: {}", item.label, e),
            ),
        }
    }

    // 3. Copy Dotfiles configured in dotfiles.mappings into bundle/dotfiles/
    emit_progress(
        app,
        2,
        "HARVEST: Coletando Dotfiles & Saves Extras",
        38,
        "running",
        Some("Copiando pastas de dotfiles".to_string()),
    );
    let mut copied_dotfile_files = 0usize;
    for mapping in profile.dotfiles.mappings.iter().filter(|m| m.enabled) {
        if check_aborted(app, cancel_flag) {
            return Err("HARVEST abortado pelo usuário.".to_string());
        }
        let resolved_live_path = resolve_windows_env_vars(&mapping.target);
        let src_path = PathBuf::from(&resolved_live_path);
        let slug = sanitize_folder_slug(&mapping.id, "dotfile");
        let dst_path = dotfiles_dir.join(&slug);

        if !src_path.exists() {
            emit_log(
                app,
                "WARN",
                3,
                format!(
                    "Dotfile [{}] ausente em \"{}\" — pulando.",
                    mapping.label, resolved_live_path
                ),
            );
            continue;
        }

        match copy_path_into_bundle(&src_path, &dst_path) {
            Ok(count) => {
                copied_dotfile_files += count;
                emit_log(
                    app,
                    "OK",
                    3,
                    format!(
                        "Dotfile [{}] salvo no bundle ({} arquivo(s) -> dotfiles/{}).",
                        mapping.label, count, slug
                    ),
                );
            }
            Err(e) => emit_log(
                app,
                "ERR",
                3,
                format!("Erro ao copiar dotfile [{}]: {}", mapping.label, e),
            ),
        }
    }

    // 4. Copy Extra Save Paths into bundle/saves/
    let mut copied_save_files = 0usize;
    for (idx, raw_save_path) in profile.extra_save_paths.iter().enumerate() {
        if check_aborted(app, cancel_flag) {
            return Err("HARVEST abortado pelo usuário.".to_string());
        }
        let trimmed = raw_save_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let resolved_save = resolve_windows_env_vars(trimmed);
        let src_path = PathBuf::from(&resolved_save);
        let leaf_name = src_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| sanitize_folder_slug(n, &format!("save_{}", idx + 1)))
            .unwrap_or_else(|| format!("save_{}", idx + 1));
        let dst_path = saves_dir.join(&leaf_name);

        if !src_path.exists() {
            emit_log(
                app,
                "WARN",
                3,
                format!("Extra save não encontrado em \"{}\" — pulando.", resolved_save),
            );
            continue;
        }

        match copy_path_into_bundle(&src_path, &dst_path) {
            Ok(count) => {
                copied_save_files += count;
                emit_log(
                    app,
                    "OK",
                    3,
                    format!("Save extra copiado ({} arquivo(s) -> saves/{}).", count, leaf_name),
                );
            }
            Err(e) => emit_log(
                app,
                "ERR",
                3,
                format!("Erro ao copiar save extra \"{}\": {}", resolved_save, e),
            ),
        }
    }

    // 5. Wi-Fi Profiles Backup (netsh wlan export profile key=clear)
    emit_progress(
        app,
        3,
        "HARVEST: Wi-Fi & Drivers",
        55,
        "running",
        Some("Exportando perfis Wi-Fi e drivers".to_string()),
    );
    if do_backup_wifi {
        if check_aborted(app, cancel_flag) {
            return Err("HARVEST abortado pelo usuário.".to_string());
        }
        let wifi_dir = vault_dir.join("wifi");
        let _ = fs::create_dir_all(&wifi_dir);
        let folder_arg = format!("folder={}", wifi_dir.display());
        emit_log(
            app,
            "INFO",
            3,
            format!("Executando: netsh wlan export profile key=clear {}", folder_arg),
        );
        match run_command_streaming(
            app,
            3,
            "netsh",
            &["wlan", "export", "profile", "key=clear", &folder_arg],
            cancel_flag,
        ) {
            Ok(0) => emit_log(app, "OK", 3, "Perfis Wi-Fi exportados em vault/wifi/."),
            Ok(code) => emit_log(
                app,
                "WARN",
                3,
                format!("netsh wlan export finalizou com código {} (verifique adaptador Wi-Fi).", code),
            ),
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                return Err("HARVEST abortado pelo usuário.".to_string());
            }
            Err(e) => emit_log(app, "WARN", 3, format!("Falha ao exportar Wi-Fi: {}", e)),
        }
    }

    // 6. Drivers Backup (pnputil /export-driver * "<output_dir>\drivers")
    if do_backup_drivers {
        if check_aborted(app, cancel_flag) {
            return Err("HARVEST abortado pelo usuário.".to_string());
        }
        let drivers_str = drivers_dir.to_string_lossy().to_string();
        emit_log(
            app,
            "INFO",
            3,
            format!("Executando: pnputil /export-driver * \"{}\"", drivers_str),
        );
        match run_command_streaming(
            app,
            3,
            "pnputil",
            &["/export-driver", "*", &drivers_str],
            cancel_flag,
        ) {
            Ok(0) => emit_log(app, "OK", 3, "Drivers de terceiros exportados para drivers/."),
            Ok(code) => emit_log(
                app,
                "WARN",
                3,
                format!("pnputil finalizou com código {} (privilégios de Administrador recomendados).", code),
            ),
            Err(ref e) if e == "ABORTED" => {
                check_aborted(app, cancel_flag);
                return Err("HARVEST abortado pelo usuário.".to_string());
            }
            Err(e) => emit_log(app, "WARN", 3, format!("Falha ao exportar drivers: {}", e)),
        }
    }

    // 7. VS Code Extensions (`code --list-extensions`)
    emit_progress(
        app,
        4,
        "HARVEST: VS Code & Auditoria de Apps Manuais",
        75,
        "running",
        Some("Capturando extensões VS Code e auditando Registro".to_string()),
    );
    if options.capture_vscode_extensions {
        if check_aborted(app, cancel_flag) {
            return Err("HARVEST abortado pelo usuário.".to_string());
        }
        let extensions = capture_vscode_extensions(app);
        if !extensions.is_empty() {
            profile.vscode_extensions = extensions;
        }
    }

    // 8. Non-WinGet Apps Detector (Registry Uninstall vs WinGet Export -> manual_apps_report.md)
    let exported_winget = export_winget_package_ids(app);
    if !exported_winget.is_empty() {
        // Merge newly exported WinGet packages while preserving user's enabled/disabled preferences
        let mut existing_ids: std::collections::HashSet<String> = profile
            .winget_packages
            .iter()
            .map(|p| p.id.to_ascii_lowercase())
            .collect();
        for pkg in &exported_winget {
            if existing_ids.insert(pkg.id.to_ascii_lowercase()) {
                profile.winget_packages.push(pkg.clone());
            }
        }
    }

    let winget_ids_for_diff: Vec<String> = if !exported_winget.is_empty() {
        exported_winget.iter().map(|p| p.id.clone()).collect()
    } else {
        profile.winget_packages.iter().map(|p| p.id.clone()).collect()
    };

    let manual_report_path = bundle_root.join("manual_apps_report.md");
    let (manual_apps_count, manual_report_markdown) = if options.detect_non_winget_apps {
        emit_log(
            app,
            "INFO",
            4,
            "Lendo chaves Uninstall do Registro (HKLM & HKCU) para detectar apps fora do WinGet...",
        );
        let registry_apps = read_installed_registry_apps();
        let manual_apps = find_non_winget_apps(&registry_apps, &winget_ids_for_diff);
        let md = build_manual_apps_markdown(
            &manual_apps,
            registry_apps.len(),
            winget_ids_for_diff.len(),
        );
        fs::write(&manual_report_path, &md)
            .map_err(|e| format!("Falha ao gravar manual_apps_report.md: {}", e))?;
        emit_log(
            app,
            "OK",
            4,
            format!(
                "Relatório manual_apps_report.md gerado: {} app(s) fora do WinGet de {} detectados no Registro.",
                manual_apps.len(),
                registry_apps.len()
            ),
        );
        (manual_apps.len(), md)
    } else {
        (0, String::new())
    };

    // 8B. Startup Folder Shortcuts Scanner -> suggest `autostart_tasks`
    if !check_aborted(app, cancel_flag) {
        let startup_suggestions = scan_startup_shortcuts(app);
        if !startup_suggestions.is_empty() {
            let mut existing_exes: std::collections::HashSet<String> = profile
                .autostart_tasks
                .iter()
                .map(|t| t.exe_path.trim().to_ascii_lowercase())
                .collect();
            for task in startup_suggestions {
                if existing_exes.insert(task.exe_path.trim().to_ascii_lowercase()) {
                    profile.autostart_tasks.push(task);
                }
            }
        }
    }

    // 9. Save updated profile.json at root of output_dir
    emit_progress(
        app,
        4,
        "HARVEST: Salvando profile.json",
        95,
        "running",
        Some("Gravando manifesto profile.json no bundle".to_string()),
    );
    let profile_path = bundle_root.join("profile.json");
    let pretty_json = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Falha ao serializar profile.json: {}", e))?;
    fs::write(&profile_path, pretty_json)
        .map_err(|e| format!("Falha ao gravar '{}': {}", profile_path.display(), e))?;

    emit_log(
        app,
        "OK",
        4,
        format!(
            "HARVEST concluído! Bundle salvo em \"{}\" (profile.json + {} vault, {} dotfiles, {} saves, {} extensões VS Code).",
            bundle_root.display(),
            copied_vault_files,
            copied_dotfile_files,
            copied_save_files,
            profile.vscode_extensions.len()
        ),
    );
    emit_progress(
        app,
        4,
        "HARVEST Concluído",
        100,
        "completed",
        Some(format!("Bundle salvo em {}", bundle_root.display())),
    );

    Ok(HarvestResult {
        output_dir: bundle_root.to_string_lossy().to_string(),
        profile_path: profile_path.to_string_lossy().to_string(),
        manual_report_path: manual_report_path.to_string_lossy().to_string(),
        manual_report_markdown,
        manual_apps_count,
        vscode_extensions_count: profile.vscode_extensions.len(),
        copied_vault_files,
        copied_dotfile_files,
        copied_save_files,
        profile,
    })
}

// ============================================================================
// 9. Portable Profile File Helpers (`read_profile_file` & `load_startup_profile`)
// ============================================================================

/// Reads and deserializes any WinForge profile JSON (such as `failed_report.json`) from disk.
#[tauri::command]
fn read_profile_file(path: String) -> Result<ProfileConfig, String> {
    let resolved = resolve_windows_env_vars(path.trim());
    let file_path = PathBuf::from(&resolved);
    let raw = fs::read_to_string(&file_path)
        .map_err(|e| format!("Falha ao ler '{}': {}", file_path.display(), e))?;
    serde_json::from_str::<ProfileConfig>(&raw)
        .map_err(|e| format!("JSON inválido em '{}': {}", file_path.display(), e))
}

/// Portable startup auto-loader: checks for `profile.json` next to `WinForge.exe`
/// (or in the current working directory) and returns it if present.
#[tauri::command]
fn load_startup_profile() -> Result<Option<ProfileConfig>, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("profile.json"));
        }
    }
    if let Ok(cwd) = env::current_dir() {
        let cwd_profile = cwd.join("profile.json");
        if !candidates.contains(&cwd_profile) {
            candidates.push(cwd_profile);
        }
    }

    for candidate in candidates {
        if candidate.is_file() {
            let raw = fs::read_to_string(&candidate)
                .map_err(|e| format!("Falha ao ler '{}': {}", candidate.display(), e))?;
            let parsed = serde_json::from_str::<ProfileConfig>(&raw)
                .map_err(|e| format!("JSON inválido em '{}': {}", candidate.display(), e))?;
            return Ok(Some(parsed));
        }
    }

    Ok(None)
}

// ============================================================================
// 10. Headless CLI Mode Runners (`--deploy` / `--harvest` -> stdout)
// ============================================================================

/// Runs a headless provisioning deploy directly from a `profile.json` file, printing logs to stdout.
pub fn run_cli_deploy(json_path: &str, dry_run: bool) -> Result<(), String> {
    let mut profile = read_profile_file(json_path.to_string())?;

    // Resolve relative bundle_root against the directory containing the profile JSON if needed
    let resolved_json = PathBuf::from(resolve_windows_env_vars(json_path.trim()));
    if let Some(json_dir) = resolved_json.parent() {
        if let Some(ref b_root) = profile.bundle_root {
            let b_path = PathBuf::from(resolve_windows_env_vars(b_root.trim()));
            if !b_path.exists() {
                let rel_candidate = json_dir.join(b_root.trim());
                if rel_candidate.exists() {
                    profile.bundle_root = Some(rel_candidate.to_string_lossy().to_string());
                } else if json_dir.join("vault").exists() || json_dir.join("dotfiles").exists() {
                    profile.bundle_root = Some(json_dir.to_string_lossy().to_string());
                }
            }
        } else if json_dir.join("vault").exists() || json_dir.join("dotfiles").exists() {
            profile.bundle_root = Some(json_dir.to_string_lossy().to_string());
        }
    }

    let (sink, summary_slot) = EventSink::stdout();
    let cancel_flag = Arc::new(AtomicBool::new(false));

    if dry_run {
        let summary = execute_dry_run_pipeline(&sink, &profile, &cancel_flag);
        if summary.failure_count > 0 || summary.status == "error" {
            return Err(format!(
                "DRY-RUN finalizado com {} falha(s).",
                summary.failure_count
            ));
        }
        return Ok(());
    }

    execute_pipeline(&sink, &profile, &cancel_flag);

    if let Ok(guard) = summary_slot.lock() {
        if let Some(ref summary) = *guard {
            if summary.status == "error" || summary.failure_count > 0 {
                return Err(format!(
                    "Deploy finalizado com status '{}' e {} falha(s).",
                    summary.status, summary.failure_count
                ));
            }
        }
    }

    Ok(())
}

/// Runs a headless HARVEST snapshot directly into `output_dir`, printing logs to stdout.
pub fn run_cli_harvest(
    output_dir: &str,
    backup_wifi: bool,
    backup_drivers: bool,
) -> Result<(), String> {
    let (sink, _) = EventSink::stdout();
    let cancel_flag = Arc::new(AtomicBool::new(false));

    let discovered_dotfiles = scan_known_dotfile_folders(&sink);
    let options = HarvestOptions {
        profile: None,
        backup_wifi,
        backup_drivers,
        capture_vscode_extensions: true,
        detect_non_winget_apps: true,
        vault_items: default_vault_items(),
        dotfile_mappings: discovered_dotfiles,
        extra_save_paths: vec![],
    };

    let result = execute_harvest_pipeline(&sink, output_dir, &options, &cancel_flag)?;
    println!("[WINFORGE] profile.json salvo em: {}", result.profile_path);
    if !result.manual_report_path.is_empty() {
        println!(
            "[WINFORGE] manual_apps_report.md salvo em: {}",
            result.manual_report_path
        );
    }
    Ok(())
}

// ============================================================================
// 11. UniGet Mode — Live WinGet Package Manager (Updates / Search / Installed)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetUpdateItem {
    pub name: String,
    pub id: String,
    pub version: String,
    pub available: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetSearchItem {
    pub name: String,
    pub id: String,
    pub version: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetInstalledItem {
    pub name: String,
    pub id: String,
    pub version: String,
    pub available: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetBatchResult {
    pub succeeded: Vec<String>,
    pub failed: Vec<String>,
}

/// Cleans WinGet stdout lines by resolving `\r` spinner overwrites and stripping control chars.
fn clean_winget_line(raw: &str) -> String {
    let after_cr = raw.rsplit('\r').next().unwrap_or(raw);
    after_cr
        .chars()
        .filter(|&c| !c.is_control() || c == '\t')
        .collect::<String>()
}

/// Extracts starting character indices of columns from a WinGet header line (localized-safe).
fn detect_column_starts(header: &str) -> Vec<usize> {
    let chars: Vec<char> = header.chars().collect();
    let mut starts = Vec::new();
    let mut i = 0;

    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    if i < chars.len() {
        starts.push(i);
    }

    let mut space_run = 0usize;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            space_run += 1;
        } else {
            if space_run >= 2 {
                starts.push(i);
            }
            space_run = 0;
        }
        i += 1;
    }

    starts
}

/// Slices a line by character index range safely.
fn slice_chars(chars: &[char], start: usize, end: Option<usize>) -> String {
    if start >= chars.len() {
        return String::new();
    }
    let hi = end.unwrap_or(chars.len()).min(chars.len());
    if hi <= start {
        return String::new();
    }
    chars[start..hi].iter().collect::<String>().trim().to_string()
}

/// Splits a row on runs of 2+ spaces as fallback when WinGet overflows column widths.
fn split_multi_space(line: &str) -> Vec<String> {
    let mut cols = Vec::new();
    let mut cur = String::new();
    let mut spaces = 0usize;

    for ch in line.chars() {
        if ch == ' ' || ch == '\t' {
            spaces += 1;
        } else {
            if spaces >= 2 {
                let trimmed = cur.trim().to_string();
                if !trimmed.is_empty() {
                    cols.push(trimmed);
                }
                cur.clear();
            } else if spaces == 1 && !cur.is_empty() {
                cur.push(' ');
            }
            spaces = 0;
            cur.push(ch);
        }
    }
    let tail = cur.trim().to_string();
    if !tail.is_empty() {
        cols.push(tail);
    }
    cols
}

fn looks_like_winget_footer(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.chars().all(|c| c == '-' || c == '─' || c == '=') {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("the following packages")
        || lower.starts_with("os seguintes pacotes")
        || lower.contains("upgrades available")
        || lower.contains("upgrade available")
        || lower.contains("atualizações disponíveis")
        || lower.contains("atualização disponível")
        || lower.contains("package(s) have version numbers")
        || lower.contains("no installed package found")
        || lower.contains("nenhum pacote instalado")
        || lower.contains("no package found")
        || lower.contains("nenhum pacote encontrado")
    {
        return true;
    }
    false
}

/// Generic WinGet fixed-width table parser returning raw column vectors aligned to the table header.
fn parse_winget_table(stdout: &str) -> (Vec<String>, Vec<Vec<String>>) {
    let cleaned_lines: Vec<String> = stdout.lines().map(clean_winget_line).collect();

    // Find the dashed separator line (at least 20 dashes)
    let sep_idx = cleaned_lines.iter().position(|line| {
        let t = line.trim();
        t.len() >= 20 && t.chars().all(|c| c == '-' || c == '─')
    });

    let Some(sep_pos) = sep_idx else {
        return (Vec::new(), Vec::new());
    };
    if sep_pos == 0 {
        return (Vec::new(), Vec::new());
    }

    let header_line = &cleaned_lines[sep_pos - 1];
    let col_starts = detect_column_starts(header_line);
    if col_starts.len() < 2 {
        return (Vec::new(), Vec::new());
    }

    let header_chars: Vec<char> = header_line.chars().collect();
    let headers: Vec<String> = col_starts
        .iter()
        .enumerate()
        .map(|(idx, &start)| {
            let end = col_starts.get(idx + 1).copied();
            slice_chars(&header_chars, start, end)
        })
        .collect();

    let mut rows: Vec<Vec<String>> = Vec::new();
    for line in &cleaned_lines[sep_pos + 1..] {
        if looks_like_winget_footer(line) {
            if !rows.is_empty() && line.trim().is_empty() {
                // Keep scanning in case there are multiple sections? Stop on summary footers.
                continue;
            }
            if !line.trim().is_empty() {
                break;
            }
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let mut parsed: Vec<String> = col_starts
            .iter()
            .enumerate()
            .map(|(idx, &start)| {
                let end = col_starts.get(idx + 1).copied();
                slice_chars(&chars, start, end)
            })
            .collect();

        // Validate ID column (index 1). If column overflow shifted tokens, fallback to multi-space split.
        let id_invalid = parsed
            .get(1)
            .map(|id| id.is_empty() || id.contains(' '))
            .unwrap_or(true);

        if id_invalid {
            let parts = split_multi_space(line);
            if parts.len() >= 2 {
                let mut rebuilt = vec![String::new(); headers.len()];
                if parts.len() >= headers.len() {
                    for (i, slot) in rebuilt.iter_mut().enumerate() {
                        *slot = parts[i].clone();
                    }
                } else {
                    for (i, val) in parts.into_iter().enumerate() {
                        if i < rebuilt.len() {
                            rebuilt[i] = val;
                        }
                    }
                }
                parsed = rebuilt;
            }
        }

        let name = parsed.first().map(|s| s.trim()).unwrap_or("");
        let id = parsed.get(1).map(|s| s.trim()).unwrap_or("");
        if !name.is_empty() && !id.is_empty() && !id.contains(' ') {
            rows.push(parsed);
        }
    }

    (headers, rows)
}

fn find_header_col(headers: &[String], candidates: &[&str]) -> Option<usize> {
    headers.iter().position(|h| {
        let lower = h.trim().to_ascii_lowercase();
        candidates.iter().any(|c| lower == *c || lower.starts_with(c))
    })
}

fn run_winget_capture(args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("winget");
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("Não foi possível executar winget (verifique se o App Installer está instalado): {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() && !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            return Err(stderr);
        }
    }
    Ok(stdout)
}

#[tauri::command]
async fn winget_check_updates(app: AppHandle) -> Result<Vec<WingetUpdateItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        emit_log(
            &sink,
            "INFO",
            2,
            "UniGet Mode: executando winget upgrade --include-unknown...",
        );

        let stdout = run_winget_capture(&[
            "upgrade",
            "--include-unknown",
            "--accept-source-agreements",
        ])?;

        let (headers, rows) = parse_winget_table(&stdout);
        let avail_col = find_header_col(&headers, &["available", "disponível", "disponivel", "verfügbar"]).unwrap_or(3);
        let ver_col = find_header_col(&headers, &["version", "versão", "versao"]).unwrap_or(2);
        let src_col = find_header_col(&headers, &["source", "origem", "quelle"]).unwrap_or(4);

        let items: Vec<WingetUpdateItem> = rows
            .into_iter()
            .filter_map(|cols| {
                let name = cols.first().cloned().unwrap_or_default();
                let id = cols.get(1).cloned().unwrap_or_default();
                let version = cols.get(ver_col).cloned().unwrap_or_default();
                let available = cols.get(avail_col).cloned().unwrap_or_default();
                let source = cols.get(src_col).cloned().unwrap_or_else(|| "winget".to_string());
                if id.is_empty() || available.is_empty() {
                    return None;
                }
                Some(WingetUpdateItem {
                    name,
                    id,
                    version,
                    available,
                    source,
                })
            })
            .collect();

        emit_log(
            &sink,
            "OK",
            2,
            format!("UniGet Mode: {} atualização(ões) disponível(is) encontrada(s).", items.len()),
        );
        Ok(items)
    })
    .await
    .map_err(|e| format!("Erro interno na thread winget_check_updates: {}", e))?
}

#[tauri::command]
async fn winget_upgrade_packages(
    app: AppHandle,
    state: State<'_, ProvisionState>,
    ids: Vec<String>,
) -> Result<WingetBatchResult, String> {
    if ids.is_empty() {
        return Ok(WingetBatchResult {
            succeeded: Vec::new(),
            failed: Vec::new(),
        });
    }
    if state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Já existe uma operação em andamento. Aguarde ou aborte antes de atualizar pacotes.".to_string());
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    let is_running = Arc::clone(&state.is_running);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        let total = ids.len();
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();

        emit_log(
            &sink,
            "INFO",
            2,
            format!("UniGet Mode: atualizando {} pacote(s) selecionado(s)...", total),
        );

        for (idx, id) in ids.iter().enumerate() {
            if check_aborted(&sink, &cancel_flag) {
                break;
            }
            let pct = ((idx as f32 / total as f32) * 100.0).round() as u8;
            emit_progress(
                &sink,
                2,
                "UniGet: Atualizando Pacotes",
                pct,
                "running",
                Some(format!("Upgrade: {}", id)),
            );
            emit_log(
                &sink,
                "INFO",
                2,
                format!("winget upgrade --id {} --exact --silent --accept-package-agreements --accept-source-agreements", id),
            );

            match run_command_streaming(
                &sink,
                2,
                "winget",
                &[
                    "upgrade",
                    "--id",
                    id,
                    "--exact",
                    "--silent",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ],
                &cancel_flag,
            ) {
                Ok(0) => {
                    emit_log(&sink, "OK", 2, format!("Pacote '{}' atualizado com sucesso.", id));
                    succeeded.push(id.clone());
                }
                Ok(code) => {
                    emit_log(
                        &sink,
                        "ERR",
                        2,
                        format!("Falha ao atualizar '{}' (código {}).", id, code),
                    );
                    failed.push(id.clone());
                }
                Err(ref e) if e == "ABORTED" => {
                    failed.push(id.clone());
                    break;
                }
                Err(err) => {
                    emit_log(&sink, "ERR", 2, format!("Erro ao atualizar '{}': {}", id, err));
                    failed.push(id.clone());
                }
            }
        }

        let summary_status = if cancel_flag.load(Ordering::Relaxed) {
            "aborted"
        } else {
            "completed"
        };
        emit_progress(
            &sink,
            2,
            "UniGet: Atualizações Finalizadas",
            100,
            summary_status,
            Some(format!("{} OK · {} falhas", succeeded.len(), failed.len())),
        );
        emit_log(
            &sink,
            if failed.is_empty() { "OK" } else { "WARN" },
            2,
            format!(
                "UniGet Update concluído: {} atualizado(s), {} falha(s).",
                succeeded.len(),
                failed.len()
            ),
        );

        is_running.store(false, Ordering::SeqCst);
        Ok(WingetBatchResult { succeeded, failed })
    })
    .await
    .map_err(|e| format!("Erro interno em winget_upgrade_packages: {}", e))?
}

#[tauri::command]
async fn winget_search(app: AppHandle, query: String) -> Result<Vec<WingetSearchItem>, String> {
    let trimmed = query.trim().to_string();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        emit_log(
            &sink,
            "INFO",
            2,
            format!("UniGet Mode: buscando '{}' no WinGet...", trimmed),
        );

        let stdout = run_winget_capture(&[
            "search",
            &trimmed,
            "--accept-source-agreements",
        ])?;

        let (headers, rows) = parse_winget_table(&stdout);
        let ver_col = find_header_col(&headers, &["version", "versão", "versao"]).unwrap_or(2);
        let src_col = find_header_col(&headers, &["source", "origem", "quelle"])
            .unwrap_or_else(|| headers.len().saturating_sub(1));

        let items: Vec<WingetSearchItem> = rows
            .into_iter()
            .take(60)
            .filter_map(|cols| {
                let name = cols.first().cloned().unwrap_or_default();
                let id = cols.get(1).cloned().unwrap_or_default();
                let version = cols.get(ver_col).cloned().unwrap_or_default();
                let source = if src_col != ver_col {
                    cols.get(src_col).cloned().unwrap_or_else(|| "winget".to_string())
                } else {
                    "winget".to_string()
                };
                if id.is_empty() {
                    return None;
                }
                Some(WingetSearchItem {
                    name,
                    id,
                    version,
                    source,
                })
            })
            .collect();

        emit_log(
            &sink,
            "OK",
            2,
            format!("Busca '{}': {} resultado(s) encontrado(s).", trimmed, items.len()),
        );
        Ok(items)
    })
    .await
    .map_err(|e| format!("Erro interno em winget_search: {}", e))?
}

#[tauri::command]
async fn winget_install_package(
    app: AppHandle,
    state: State<'_, ProvisionState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let clean_id = id.trim().to_string();
    if clean_id.is_empty() {
        return Err("ID do pacote WinGet vazio.".to_string());
    }
    if state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Já existe uma operação em andamento. Aguarde a conclusão.".to_string());
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    let is_running = Arc::clone(&state.is_running);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        let display = if name.trim().is_empty() { clean_id.clone() } else { name };
        emit_progress(
            &sink,
            2,
            "UniGet: Instalando Pacote",
            30,
            "running",
            Some(format!("Instalando {} ({})", display, clean_id)),
        );
        emit_log(
            &sink,
            "INFO",
            2,
            format!(
                "winget install --id {} --exact --silent --accept-package-agreements --accept-source-agreements",
                clean_id
            ),
        );

        let res = run_command_streaming(
            &sink,
            2,
            "winget",
            &[
                "install",
                "--id",
                &clean_id,
                "--exact",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ],
            &cancel_flag,
        );

        is_running.store(false, Ordering::SeqCst);

        match res {
            Ok(0) => {
                emit_log(&sink, "OK", 2, format!("{} ({}) instalado com sucesso.", display, clean_id));
                emit_progress(&sink, 2, "UniGet: Instalação Concluída", 100, "completed", Some(display));
                Ok(())
            }
            Ok(code) => {
                let msg = format!("WinGet retornou código {} ao instalar {}.", code, clean_id);
                emit_log(&sink, "ERR", 2, &msg);
                emit_progress(&sink, 2, "UniGet: Erro na Instalação", 100, "error", Some(clean_id));
                Err(msg)
            }
            Err(e) => {
                emit_log(&sink, "ERR", 2, format!("Falha ao instalar {}: {}", clean_id, e));
                emit_progress(&sink, 2, "UniGet: Operação Cancelada", 100, "aborted", None);
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| format!("Erro interno em winget_install_package: {}", e))?
}

#[tauri::command]
async fn winget_list_installed(app: AppHandle) -> Result<Vec<WingetInstalledItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        emit_log(&sink, "INFO", 2, "UniGet Mode: listando pacotes instalados (winget list)...");

        let stdout = run_winget_capture(&["list", "--accept-source-agreements"])?;
        let (headers, rows) = parse_winget_table(&stdout);

        let ver_col = find_header_col(&headers, &["version", "versão", "versao"]).unwrap_or(2);
        let avail_col = find_header_col(&headers, &["available", "disponível", "disponivel", "verfügbar"]);
        let src_col = find_header_col(&headers, &["source", "origem", "quelle"]);

        let items: Vec<WingetInstalledItem> = rows
            .into_iter()
            .filter_map(|cols| {
                let name = cols.first().cloned().unwrap_or_default();
                let id = cols.get(1).cloned().unwrap_or_default();
                let version = cols.get(ver_col).cloned().unwrap_or_default();
                let available = avail_col
                    .and_then(|idx| cols.get(idx).cloned())
                    .unwrap_or_default();
                let source = src_col
                    .and_then(|idx| cols.get(idx).cloned())
                    .unwrap_or_default();
                if id.is_empty() {
                    return None;
                }
                Some(WingetInstalledItem {
                    name,
                    id,
                    version,
                    available,
                    source,
                })
            })
            .collect();

        emit_log(
            &sink,
            "OK",
            2,
            format!("UniGet Mode: {} pacote(s) instalado(s) carregado(s).", items.len()),
        );
        Ok(items)
    })
    .await
    .map_err(|e| format!("Erro interno em winget_list_installed: {}", e))?
}

#[tauri::command]
async fn winget_uninstall_package(
    app: AppHandle,
    state: State<'_, ProvisionState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let clean_id = id.trim().to_string();
    if clean_id.is_empty() {
        return Err("ID do pacote vazio.".to_string());
    }
    if state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Já existe uma operação em andamento. Aguarde a conclusão.".to_string());
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    let is_running = Arc::clone(&state.is_running);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        let display = if name.trim().is_empty() { clean_id.clone() } else { name };
        emit_progress(
            &sink,
            2,
            "UniGet: Desinstalando Pacote",
            35,
            "running",
            Some(format!("Removendo {} ({})", display, clean_id)),
        );
        emit_log(
            &sink,
            "WARN",
            2,
            format!("winget uninstall --id {} --exact --silent --accept-source-agreements", clean_id),
        );

        let res = run_command_streaming(
            &sink,
            2,
            "winget",
            &[
                "uninstall",
                "--id",
                &clean_id,
                "--exact",
                "--silent",
                "--accept-source-agreements",
            ],
            &cancel_flag,
        );

        is_running.store(false, Ordering::SeqCst);

        match res {
            Ok(0) => {
                emit_log(&sink, "OK", 2, format!("{} ({}) desinstalado com sucesso.", display, clean_id));
                emit_progress(&sink, 2, "UniGet: Desinstalação Concluída", 100, "completed", Some(display));
                Ok(())
            }
            Ok(code) => {
                let msg = format!("WinGet retornou código {} ao desinstalar {}.", code, clean_id);
                emit_log(&sink, "ERR", 2, &msg);
                emit_progress(&sink, 2, "UniGet: Erro na Desinstalação", 100, "error", Some(clean_id));
                Err(msg)
            }
            Err(e) => {
                emit_log(&sink, "ERR", 2, format!("Falha ao desinstalar {}: {}", clean_id, e));
                emit_progress(&sink, 2, "UniGet: Operação Cancelada", 100, "aborted", None);
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| format!("Erro interno em winget_uninstall_package: {}", e))?
}

/// Persists updated `profile.json` back to disk when a portable profile already exists
/// in `bundle_root` or alongside `WinForge.exe`.
#[tauri::command]
fn save_profile_to_disk(profile: ProfileConfig) -> Result<Option<String>, String> {
    let mut target: Option<PathBuf> = None;

    if let Some(ref b_root) = profile.bundle_root {
        let trimmed = b_root.trim();
        if !trimmed.is_empty() {
            let dir = PathBuf::from(resolve_windows_env_vars(trimmed));
            if dir.exists() {
                target = Some(dir.join("profile.json"));
            }
        }
    }

    if target.is_none() {
        if let Ok(exe_path) = env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidate = exe_dir.join("profile.json");
                if candidate.is_file() {
                    target = Some(candidate);
                }
            }
        }
    }

    if target.is_none() {
        if let Ok(cwd) = env::current_dir() {
            let candidate = cwd.join("profile.json");
            if candidate.is_file() {
                target = Some(candidate);
            }
        }
    }

    let Some(path) = target else {
        return Ok(None);
    };

    let pretty = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Falha ao serializar profile.json: {}", e))?;
    fs::write(&path, pretty)
        .map_err(|e| format!("Falha ao salvar '{}': {}", path.display(), e))?;

    Ok(Some(path.to_string_lossy().to_string()))
}

// ============================================================================
// 12. Reverse Dotfiles & Vault Sync (`sync_dotfiles_reverse`)
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseSyncResult {
    pub target_dir: String,
    pub copied_dotfiles: usize,
    pub copied_vault_files: usize,
    pub exported_windhawk_reg: bool,
    pub git_pushed: bool,
    pub git_message: String,
}

fn copy_any_path(src: &Path, dst: &Path) -> std::io::Result<usize> {
    if !src.exists() {
        return Ok(0);
    }
    if src.is_dir() {
        return copy_dir_all(src, dst);
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dst)?;
    Ok(1)
}

fn export_windhawk_registry(sink: &EventSink, dest_reg_file: &Path) -> bool {
    if let Some(parent) = dest_reg_file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let dest_str = dest_reg_file.to_string_lossy().to_string();

    for key in [r"HKLM\SOFTWARE\Windhawk", r"HKCU\Software\Windhawk"] {
        let mut cmd = Command::new("reg.exe");
        cmd.args(["export", key, &dest_str, "/y"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        apply_no_window(&mut cmd);

        if let Ok(status) = cmd.status() {
            if status.success() && dest_reg_file.is_file() {
                emit_log(
                    sink,
                    "OK",
                    3,
                    format!("Registro do Windhawk ({}) exportado para \"{}\".", key, dest_str),
                );
                return true;
            }
        }
    }

    emit_log(
        sink,
        "INFO",
        3,
        "Chave de registro do Windhawk não encontrada neste sistema (ignorado).",
    );
    false
}

fn run_git_sync_commit_push(
    sink: &EventSink,
    repo_dir: &Path,
    cancel_flag: &Arc<AtomicBool>,
) -> (bool, String) {
    let dir_str = repo_dir.to_string_lossy().to_string();
    emit_log(
        sink,
        "INFO",
        3,
        format!("Git Sync: executando git add / commit / push em \"{}\"...", dir_str),
    );

    if let Err(e) = run_command_streaming(sink, 3, "git", &["-C", &dir_str, "add", "."], cancel_flag) {
        return (false, format!("git add falhou: {}", e));
    }

    // Check if there are staged changes before committing
    let mut diff_cmd = Command::new("git");
    diff_cmd
        .args(["-C", &dir_str, "diff", "--cached", "--quiet"])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut diff_cmd);

    let has_changes = match diff_cmd.status() {
        Ok(s) => !s.success(),
        Err(_) => true,
    };

    if !has_changes {
        emit_log(sink, "OK", 3, "Git Sync: nenhuma alteração pendente para commit.");
        return (true, "Repositório já estava atualizado (sem alterações).".to_string());
    }

    match run_command_streaming(
        sink,
        3,
        "git",
        &["-C", &dir_str, "commit", "-m", "chore: sync dotfiles"],
        cancel_flag,
    ) {
        Ok(0) => {
            emit_log(sink, "OK", 3, "Commit criado: \"chore: sync dotfiles\".");
        }
        Ok(code) => {
            let msg = format!("git commit retornou código {}.", code);
            emit_log(sink, "WARN", 3, &msg);
            return (false, msg);
        }
        Err(e) => {
            let msg = format!("Falha no git commit: {}", e);
            emit_log(sink, "ERR", 3, &msg);
            return (false, msg);
        }
    }

    match run_command_streaming(sink, 3, "git", &["-C", &dir_str, "push"], cancel_flag) {
        Ok(0) => {
            emit_log(sink, "OK", 3, "git push concluído com sucesso!");
            (true, "Commit 'chore: sync dotfiles' enviado via git push.".to_string())
        }
        Ok(code) => {
            let msg = format!("git push retornou código {} (verifique credenciais SSH/HTTPS).", code);
            emit_log(sink, "WARN", 3, &msg);
            (false, msg)
        }
        Err(e) => {
            let msg = format!("Falha no git push: {}", e);
            emit_log(sink, "ERR", 3, &msg);
            (false, msg)
        }
    }
}

#[tauri::command]
async fn sync_dotfiles_reverse(
    app: AppHandle,
    state: State<'_, ProvisionState>,
    profile: ProfileConfig,
) -> Result<ReverseSyncResult, String> {
    if state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Já existe uma operação em andamento. Aguarde a conclusão.".to_string());
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    let is_running = Arc::clone(&state.is_running);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    let res = tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        emit_progress(
            &sink,
            3,
            "Reverse Sync: Copiando Dotfiles & Vault",
            15,
            "running",
            Some("Preparando pasta local de destino".to_string()),
        );

        let local_root: PathBuf = profile
            .bundle_root
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| PathBuf::from(resolve_windows_env_vars(s)))
            .unwrap_or_else(|| {
                env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.join("WinForge_Bundle")))
                    .unwrap_or_else(|| PathBuf::from("./WinForge_Bundle"))
            });

        let dotfiles_dir = local_root.join("dotfiles");
        let vault_dir = local_root.join("vault");
        fs::create_dir_all(&dotfiles_dir)
            .map_err(|e| format!("Falha ao criar '{}': {}", dotfiles_dir.display(), e))?;
        fs::create_dir_all(&vault_dir)
            .map_err(|e| format!("Falha ao criar '{}': {}", vault_dir.display(), e))?;

        emit_log(
            &sink,
            "INFO",
            3,
            format!("SYNC TO REPO / VAULT iniciado -> \"{}\"", local_root.display()),
        );

        let mut copied_dotfiles = 0usize;
        let mut copied_vault_files = 0usize;
        let mut covered_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 1. Copy enabled dotfile mappings from system target -> bundle/dotfiles/<slug>
        for mapping in profile.dotfiles.mappings.iter().filter(|m| m.enabled) {
            if check_aborted(&sink, &cancel_flag) {
                return Err("Sync abortado pelo usuário.".to_string());
            }
            let sys_src = PathBuf::from(resolve_windows_env_vars(&mapping.target));
            covered_paths.insert(sys_src.to_string_lossy().to_ascii_lowercase());
            if !sys_src.exists() {
                emit_log(
                    &sink,
                    "WARN",
                    3,
                    format!("Dotfile [{}] não encontrado em \"{}\" — pulando.", mapping.label, sys_src.display()),
                );
                continue;
            }
            let slug = sanitize_folder_slug(&mapping.id, "dotfile");
            let dst = if sys_src.is_file() {
                let fname = sys_src.file_name().unwrap_or_default();
                dotfiles_dir.join(&slug).join(fname)
            } else {
                dotfiles_dir.join(&slug)
            };

            match copy_any_path(&sys_src, &dst) {
                Ok(n) => {
                    copied_dotfiles += n;
                    emit_log(
                        &sink,
                        "OK",
                        3,
                        format!("Dotfile [{}] sincronizado ({} arq.) <- \"{}\"", mapping.label, n, sys_src.display()),
                    );
                }
                Err(e) => emit_log(
                    &sink,
                    "WARN",
                    3,
                    format!("Erro ao copiar [{}]: {}", mapping.label, e),
                ),
            }
        }

        // 2. Also capture standard YASB / Flow Launcher / Windows Terminal configs if present & not yet covered
        let builtin_dotfiles = [
            ("yasb", "YASB", "%USERPROFILE%\\.config\\yasb"),
            ("flow_launcher", "Flow Launcher", "%APPDATA%\\FlowLauncher"),
            (
                "windows_terminal",
                "Windows Terminal",
                "%LOCALAPPDATA%\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json",
            ),
        ];
        for (slug, label, raw_path) in builtin_dotfiles {
            let sys_src = PathBuf::from(resolve_windows_env_vars(raw_path));
            let key = sys_src.to_string_lossy().to_ascii_lowercase();
            if covered_paths.contains(&key) || !sys_src.exists() {
                continue;
            }
            let dst = if sys_src.is_file() {
                dotfiles_dir.join(slug).join(sys_src.file_name().unwrap_or_default())
            } else {
                dotfiles_dir.join(slug)
            };
            if let Ok(n) = copy_any_path(&sys_src, &dst) {
                if n > 0 {
                    copied_dotfiles += n;
                    emit_log(
                        &sink,
                        "OK",
                        3,
                        format!("Config detectada [{}] copiada ({} arq.).", label, n),
                    );
                }
            }
        }

        // 3. Copy Vault items (.ssh, .gitconfig, .npmrc, Terminal, OBS, etc.) -> local_root/<bundle_subpath>
        emit_progress(
            &sink,
            3,
            "Reverse Sync: Vault & Windhawk",
            50,
            "running",
            Some("Copiando .ssh / Vault e exportando registro do Windhawk".to_string()),
        );
        let vault_items = if profile.vault_items.is_empty() {
            default_vault_items()
        } else {
            profile.vault_items.clone()
        };
        for item in vault_items.iter().filter(|v| v.enabled) {
            if check_aborted(&sink, &cancel_flag) {
                return Err("Sync abortado pelo usuário.".to_string());
            }
            let sys_src = PathBuf::from(resolve_windows_env_vars(&item.source_path));
            if !sys_src.exists() {
                continue;
            }
            let sub = if item.bundle_subpath.trim().is_empty() {
                format!("vault/{}", sanitize_folder_slug(&item.id, "vault_item"))
            } else {
                item.bundle_subpath.trim().replace('\\', "/")
            };
            let dst = if sys_src.is_file() {
                let target_candidate = local_root.join(&sub);
                if target_candidate.extension().is_some() {
                    target_candidate
                } else {
                    target_candidate.join(sys_src.file_name().unwrap_or_default())
                }
            } else {
                local_root.join(&sub)
            };

            match copy_any_path(&sys_src, &dst) {
                Ok(n) => {
                    copied_vault_files += n;
                    emit_log(
                        &sink,
                        "OK",
                        3,
                        format!("Vault [{}] sincronizado ({} arq.) -> \"{}\"", item.label, n, dst.display()),
                    );
                }
                Err(e) => emit_log(
                    &sink,
                    "WARN",
                    3,
                    format!("Falha ao copiar Vault [{}]: {}", item.label, e),
                ),
            }
        }

        // 4. Export Windhawk registry -> local_root/dotfiles/windhawk.reg
        let windhawk_reg_path = dotfiles_dir.join("windhawk.reg");
        let exported_windhawk_reg = export_windhawk_registry(&sink, &windhawk_reg_path);

        // 5. Save profile.json in local_root
        let profile_json_path = local_root.join("profile.json");
        if let Ok(pretty) = serde_json::to_string_pretty(&profile) {
            let _ = fs::write(&profile_json_path, pretty);
        }

        // 6. Git add / commit / push if local_root is a Git repo OR dotfiles.repo_url is configured
        emit_progress(
            &sink,
            3,
            "Reverse Sync: Git Commit & Push",
            78,
            "running",
            Some("Sincronizando com repositório Git".to_string()),
        );

        let (git_pushed, git_message) = if local_root.join(".git").exists() {
            run_git_sync_commit_push(&sink, &local_root, &cancel_flag)
        } else if !profile.dotfiles.repo_url.trim().is_empty() {
            let repo_url = profile.dotfiles.repo_url.trim();
            let repo_work_dir = PathBuf::from(resolve_windows_env_vars("%LOCALAPPDATA%"))
                .join("WinForge")
                .join("dotfiles-repo");

            let repo_ready = if repo_work_dir.join(".git").exists() {
                let d = repo_work_dir.to_string_lossy().to_string();
                emit_log(&sink, "INFO", 3, format!("Atualizando repositório Git local em \"{}\"...", d));
                run_command_streaming(&sink, 3, "git", &["-C", &d, "pull", "--rebase"], &cancel_flag).is_ok()
            } else {
                if let Some(parent) = repo_work_dir.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let d = repo_work_dir.to_string_lossy().to_string();
                emit_log(&sink, "INFO", 3, format!("Clonando {} em \"{}\"...", repo_url, d));
                matches!(
                    run_command_streaming(&sink, 3, "git", &["clone", repo_url, &d], &cancel_flag),
                    Ok(0)
                )
            };

            if repo_ready {
                // Mirror mapped dotfiles (never private .ssh keys!) into the Git repo working tree
                for mapping in profile.dotfiles.mappings.iter().filter(|m| m.enabled) {
                    let sys_src = PathBuf::from(resolve_windows_env_vars(&mapping.target));
                    if !sys_src.exists() {
                        continue;
                    }
                    let rel = mapping
                        .source
                        .trim()
                        .replace('\\', "/")
                        .trim_end_matches("/*")
                        .trim_start_matches('/')
                        .to_string();
                    if rel.is_empty() {
                        continue;
                    }
                    let repo_dst = repo_work_dir.join(&rel);
                    let _ = copy_any_path(&sys_src, &repo_dst);
                }
                if exported_windhawk_reg && windhawk_reg_path.is_file() {
                    let _ = fs::copy(&windhawk_reg_path, repo_work_dir.join("windhawk.reg"));
                }
                run_git_sync_commit_push(&sink, &repo_work_dir, &cancel_flag)
            } else {
                let msg = format!(
                    "Não foi possível clonar/atualizar '{}'. Arquivos locais salvos em \"{}\".",
                    repo_url,
                    local_root.display()
                );
                emit_log(&sink, "WARN", 3, &msg);
                (false, msg)
            }
        } else {
            (
                false,
                "Nenhum repositório Git configurado (backup salvo apenas localmente no bundle).".to_string(),
            )
        };

        emit_progress(
            &sink,
            3,
            "Reverse Sync Concluído",
            100,
            "completed",
            Some(format!("{} dotfiles · {} vault", copied_dotfiles, copied_vault_files)),
        );
        emit_log(
            &sink,
            "OK",
            3,
            format!(
                "SYNC TO REPO / VAULT finalizado: {} dotfile(s), {} arquivo(s) Vault, Windhawk .reg={}.",
                copied_dotfiles,
                copied_vault_files,
                if exported_windhawk_reg { "OK" } else { "N/A" }
            ),
        );

        Ok(ReverseSyncResult {
            target_dir: local_root.to_string_lossy().to_string(),
            copied_dotfiles,
            copied_vault_files,
            exported_windhawk_reg,
            git_pushed,
            git_message,
        })
    })
    .await
    .map_err(|e| format!("Erro interno em sync_dotfiles_reverse: {}", e))?;

    is_running.store(false, Ordering::SeqCst);
    res
}

// ============================================================================
// 13. Quick Maintenance (`clean_temp_winget` & `sfc_scannow`)
// ============================================================================

fn clean_directory_best_effort(dir: &Path) -> (usize, u64) {
    let mut removed_files = 0usize;
    let mut freed_bytes = 0u64;

    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(meta) = entry.metadata() {
            if meta.is_dir() {
                let (sub_files, sub_bytes) = clean_directory_best_effort(&path);
                removed_files += sub_files;
                freed_bytes += sub_bytes;
                let _ = fs::remove_dir(&path);
            } else {
                let size = meta.len();
                if fs::remove_file(&path).is_ok() {
                    removed_files += 1;
                    freed_bytes += size;
                }
            }
        }
    }

    (removed_files, freed_bytes)
}

fn decode_console_line_bytes(bytes: &[u8]) -> String {
    // Handle UTF-16LE output from Windows utilities like `sfc.exe /scannow`
    if bytes.len() >= 2 && bytes.iter().filter(|&&b| b == 0).count() > bytes.len() / 4 {
        let start = if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
            2
        } else {
            0
        };
        let u16s: Vec<u16> = bytes[start..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s).replace('\0', "")
    } else {
        String::from_utf8_lossy(bytes).replace('\0', "")
    }
}

#[tauri::command]
async fn run_quick_maintenance(
    app: AppHandle,
    state: State<'_, ProvisionState>,
    action: String,
) -> Result<String, String> {
    if state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Já existe uma tarefa em execução. Aguarde ou aborte antes de rodar manutenção.".to_string());
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    let is_running = Arc::clone(&state.is_running);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        match action.as_str() {
            "clean_temp_winget" => {
                emit_progress(
                    &sink,
                    1,
                    "Manutenção: Limpando %TEMP% & WinGet",
                    20,
                    "running",
                    Some("Removendo arquivos temporários e cache do WinGet".to_string()),
                );
                emit_log(&sink, "INFO", 1, "Quick Maintenance: iniciando limpeza de %TEMP% + cache do WinGet...");

                let mut targets: Vec<PathBuf> = Vec::new();
                let temp_env = env::temp_dir();
                targets.push(temp_env.clone());

                for raw in [
                    "%LOCALAPPDATA%\\Temp",
                    "%LOCALAPPDATA%\\Temp\\WinGet",
                    "%LOCALAPPDATA%\\Packages\\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe\\LocalCache",
                ] {
                    let p = PathBuf::from(resolve_windows_env_vars(raw));
                    if p.exists() && !targets.iter().any(|existing| existing == &p) {
                        targets.push(p);
                    }
                }

                let mut total_files = 0usize;
                let mut total_bytes = 0u64;

                for dir in &targets {
                    if check_aborted(&sink, &cancel_flag) {
                        return Err("Limpeza abortada pelo usuário.".to_string());
                    }
                    let (files, bytes) = clean_directory_best_effort(dir);
                    total_files += files;
                    total_bytes += bytes;
                    emit_log(
                        &sink,
                        "INFO",
                        1,
                        format!(
                            "Limpo \"{}\": {} arquivo(s) ({:.2} MB).",
                            dir.display(),
                            files,
                            bytes as f64 / (1024.0 * 1024.0)
                        ),
                    );
                }

                let freed_mb = total_bytes as f64 / (1024.0 * 1024.0);
                let summary = format!(
                    "Limpeza concluída: {} arquivo(s) removidos ({:.2} MB liberados).",
                    total_files, freed_mb
                );
                emit_log(&sink, "OK", 1, &summary);
                emit_progress(&sink, 1, "Manutenção Concluída", 100, "completed", Some(summary.clone()));
                Ok(summary)
            }
            "sfc_scannow" => {
                if !is_user_admin_native() {
                    emit_log(
                        &sink,
                        "WARN",
                        1,
                        "sfc /scannow requer privilégios de Administrador (UAC). Tentando executar...",
                    );
                }
                emit_progress(
                    &sink,
                    1,
                    "Manutenção: sfc /scannow",
                    15,
                    "running",
                    Some("Verificando integridade dos arquivos do Windows...".to_string()),
                );
                emit_log(&sink, "INFO", 1, "Executando sfc.exe /scannow (pode levar alguns minutos)...");

                let mut cmd = Command::new("sfc.exe");
                cmd.arg("/scannow")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                apply_no_window(&mut cmd);

                let mut child = cmd
                    .spawn()
                    .map_err(|e| format!("Falha ao iniciar sfc.exe: {}", e))?;

                let stdout = child.stdout.take();
                let sink_out = sink.clone();
                let out_handle = thread::spawn(move || {
                    if let Some(out) = stdout {
                        let mut reader = BufReader::new(out);
                        let mut buf = Vec::new();
                        while let Ok(n) = reader.read_until(b'\n', &mut buf) {
                            if n == 0 {
                                break;
                            }
                            let decoded = decode_console_line_bytes(&buf);
                            let clean = decoded.rsplit('\r').next().unwrap_or(&decoded).trim();
                            if !clean.is_empty() {
                                emit_log(&sink_out, "INFO", 1, clean);
                            }
                            buf.clear();
                        }
                    }
                });

                let exit_code = loop {
                    if cancel_flag.load(Ordering::Relaxed) {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = out_handle.join();
                        emit_progress(&sink, 1, "sfc /scannow Abortado", 100, "aborted", None);
                        return Err("sfc /scannow abortado pelo usuário.".to_string());
                    }
                    match child.try_wait() {
                        Ok(Some(status)) => break status.code().unwrap_or(-1),
                        Ok(None) => thread::sleep(std::time::Duration::from_millis(120)),
                        Err(e) => {
                            let _ = out_handle.join();
                            return Err(format!("Erro ao aguardar sfc.exe: {}", e));
                        }
                    }
                };
                let _ = out_handle.join();

                if exit_code == 0 {
                    let msg = "sfc /scannow concluído com sucesso (código 0).".to_string();
                    emit_log(&sink, "OK", 1, &msg);
                    emit_progress(&sink, 1, "sfc /scannow Concluído", 100, "completed", Some(msg.clone()));
                    Ok(msg)
                } else {
                    let msg = format!("sfc /scannow finalizou com código {} (verifique privilégios Admin).", exit_code);
                    emit_log(&sink, "WARN", 1, &msg);
                    emit_progress(&sink, 1, "sfc /scannow Finalizado", 100, "completed", Some(msg.clone()));
                    Ok(msg)
                }
            }
            other => Err(format!("Ação de manutenção desconhecida: '{}'", other)),
        }
    })
    .await
    .map_err(|e| format!("Erro interno em run_quick_maintenance: {}", e))?;

    is_running.store(false, Ordering::SeqCst);
    result
}

// ============================================================================
// 14. Tauri v2 Application Builder + System Tray & Hide-on-Close
// ============================================================================

fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ProvisionState::default())
        .manage(power_modules::PowerModulesState::default())
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "tray_open", "Abrir WinForge", true, None::<&str>)?;
            let updates_item = MenuItem::with_id(
                app,
                "tray_updates",
                "Checar Atualizações",
                true,
                None::<&str>,
            )?;
            let sync_item = MenuItem::with_id(app, "tray_sync", "Sync Dotfiles", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray_quit", "Sair", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&open_item, &updates_item, &sync_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("winforge-tray")
                .tooltip("WinForge — System & Package Manager")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
                    "tray_open" => {
                        restore_main_window(app_handle);
                    }
                    "tray_updates" => {
                        restore_main_window(app_handle);
                        let _ = app_handle.emit(EVENT_TRAY_ACTION, "check-updates");
                    }
                    "tray_sync" => {
                        restore_main_window(app_handle);
                        let _ = app_handle.emit(EVENT_TRAY_ACTION, "sync-dotfiles");
                    }
                    "tray_quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        restore_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;

            // Register global hotkeys (Ctrl+Shift+T, Ctrl+Shift+C, Ctrl+Alt+V, Ctrl+Shift+E)
            // and initialize the dedicated WH_KEYBOARD_LL thread (Double-Ctrl Find My Mouse + Key Remapper)
            let power_state = app.state::<power_modules::PowerModulesState>();
            power_modules::init_global_hotkeys(app.handle(), &power_state);
            power_modules::init_keyboard_hook_thread(app.handle(), &power_state);

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_admin,
            run_provisioning,
            abort_provisioning,
            scan_current_system,
            scan_startup_tasks,
            deploy_autostart_tasks,
            run_harvest,
            read_profile_file,
            load_startup_profile,
            save_profile_to_disk,
            winget_check_updates,
            winget_upgrade_packages,
            winget_search,
            winget_install_package,
            winget_list_installed,
            winget_uninstall_package,
            sync_dotfiles_reverse,
            run_quick_maintenance,
            power_modules::get_system_health,
            power_modules::toggle_awake,
            power_modules::toggle_always_on_top,
            power_modules::pick_screen_color,
            power_modules::paste_plain_text,
            power_modules::get_env_vars,
            power_modules::save_env_var,
            power_modules::delete_env_var,
            power_modules::get_wintoys_tweaks_status,
            power_modules::apply_wintoys_tweak,
            power_modules::run_wintoys_repair,
            power_modules::get_powertools_config,
            power_modules::update_powertools_config,
            power_modules::open_ocr_overlay,
            power_modules::extract_text_from_region,
            power_modules::read_hosts_file,
            power_modules::save_hosts_file,
            power_modules::batch_resize_images,
            power_modules::trigger_find_my_mouse,
            power_modules::set_mouse_crosshair,
            power_modules::sync_key_remaps
        ])
        .run(tauri::generate_context!())
        .expect("error while running WinForge Tauri application");
}
