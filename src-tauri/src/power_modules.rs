use crate::{emit_log, resolve_windows_env_vars, EventSink, KeyRemapRule};
use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, System};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const EVENT_POWERTOOL: &str = "powertool-event";
pub const EVENT_MOUSE_OVERLAY: &str = "mouse-overlay-state";

// ============================================================================
// 1. Shared State & Data Structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskHealth {
    pub name: String,
    pub mount_point: String,
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub name: String,
    pub label: String,
    pub state: String,
    pub running: bool,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemHealthReport {
    pub cpu_usage_pct: f32,
    pub cpu_cores: usize,
    pub ram_used_bytes: u64,
    pub ram_total_bytes: u64,
    pub uptime_secs: u64,
    pub disks: Vec<DiskHealth>,
    pub services: Vec<ServiceStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwakeStatus {
    pub enabled: bool,
    pub keep_screen_on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlwaysOnTopResult {
    pub window_title: String,
    pub is_topmost: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedColor {
    pub hex: String,
    pub rgb: String,
    pub hsl: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub x: i32,
    pub y: i32,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarEntry {
    pub scope: String, // "user" | "system"
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WintoysTweakState {
    pub id: String,
    pub category: String, // "Explorer" | "Privacy" | "Performance" | "Services"
    pub label: String,
    pub description: String,
    pub enabled: bool,
}

fn default_true_bool() -> bool {
    true
}

fn default_hotkey_ocr() -> String {
    "Ctrl+Shift+E".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerToolsConfig {
    pub awake_enabled: bool,
    pub awake_keep_screen_on: bool,
    pub always_on_top_enabled: bool,
    pub color_picker_enabled: bool,
    pub plain_text_enabled: bool,
    #[serde(default = "default_true_bool")]
    pub ocr_enabled: bool,
    #[serde(default = "default_true_bool")]
    pub find_my_mouse_enabled: bool,
    #[serde(default)]
    pub mouse_crosshair_enabled: bool,
    #[serde(default = "default_true_bool")]
    pub key_remapper_enabled: bool,
    pub hotkey_always_on_top: String,
    pub hotkey_color_picker: String,
    pub hotkey_plain_text: String,
    #[serde(default = "default_hotkey_ocr")]
    pub hotkey_ocr: String,
}

impl Default for PowerToolsConfig {
    fn default() -> Self {
        Self {
            awake_enabled: false,
            awake_keep_screen_on: true,
            always_on_top_enabled: true,
            color_picker_enabled: true,
            plain_text_enabled: true,
            ocr_enabled: true,
            find_my_mouse_enabled: true,
            mouse_crosshair_enabled: false,
            key_remapper_enabled: true,
            hotkey_always_on_top: "Ctrl+Shift+T".to_string(),
            hotkey_color_picker: "Ctrl+Shift+C".to_string(),
            hotkey_plain_text: "Ctrl+Alt+V".to_string(),
            hotkey_ocr: "Ctrl+Shift+E".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrExtractResult {
    pub text: String,
    pub line_count: usize,
    pub char_count: usize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEntry {
    pub id: String,
    pub ip: String,
    pub domain: String,
    #[serde(default)]
    pub comment: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizedImageItem {
    pub source_path: String,
    pub output_path: String,
    pub original_width: u32,
    pub original_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub output_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResizeResult {
    pub succeeded: Vec<ResizedImageItem>,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseOverlayState {
    pub x: f64,
    pub y: f64,
    pub spotlight_active: bool,
    pub crosshair_active: bool,
    pub spotlight_radius: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerToolEventPayload {
    pub kind: String, // "color-picked" | "always-on-top" | "plain-text" | "ocr-extracted" | "error"
    pub message: String,
    pub color: Option<PickedColor>,
    pub always_on_top: Option<AlwaysOnTopResult>,
    pub ocr: Option<OcrExtractResult>,
}

#[derive(Default)]
struct RegisteredHotkeys {
    action_by_id: HashMap<u32, String>,
    registered_keys: Vec<HotKey>,
}

#[derive(Default)]
struct MouseOverlayRuntime {
    spotlight_until: Option<Instant>,
    crosshair_active: bool,
}

pub struct PowerModulesState {
    sys: Mutex<System>,
    cpu_primed: Mutex<bool>,
    pub config: Arc<Mutex<PowerToolsConfig>>,
    hotkey_map: Arc<Mutex<RegisteredHotkeys>>,
    mouse_runtime: Arc<Mutex<MouseOverlayRuntime>>,
}

impl Default for PowerModulesState {
    fn default() -> Self {
        Self {
            sys: Mutex::new(System::new()),
            cpu_primed: Mutex::new(false),
            config: Arc::new(Mutex::new(PowerToolsConfig::default())),
            hotkey_map: Arc::new(Mutex::new(RegisteredHotkeys::default())),
            mouse_runtime: Arc::new(Mutex::new(MouseOverlayRuntime::default())),
        }
    }
}

thread_local! {
    static MAIN_HOTKEY_MANAGER: RefCell<Option<GlobalHotKeyManager>> = const { RefCell::new(None) };
}

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

// ============================================================================
// 2. System Health Telemetry (`get_system_health`)
// ============================================================================

fn query_windows_service(service_name: &str, label: &str) -> ServiceStatus {
    #[cfg(target_os = "windows")]
    {
        let mut q_cmd = Command::new("sc.exe");
        q_cmd
            .args(["query", service_name])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        apply_no_window(&mut q_cmd);

        let state_out = q_cmd
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_ascii_uppercase())
            .unwrap_or_default();

        let running = state_out.contains("RUNNING");
        let state = if running {
            "RUNNING".to_string()
        } else if state_out.contains("STOPPED") {
            "STOPPED".to_string()
        } else if state_out.contains("PAUSED") {
            "PAUSED".to_string()
        } else {
            "UNKNOWN".to_string()
        };

        let mut qc_cmd = Command::new("sc.exe");
        qc_cmd
            .args(["qc", service_name])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        apply_no_window(&mut qc_cmd);

        let qc_out = qc_cmd
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_ascii_uppercase())
            .unwrap_or_default();

        let disabled = qc_out.contains("DISABLED");

        ServiceStatus {
            name: service_name.to_string(),
            label: label.to_string(),
            state,
            running,
            disabled,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        ServiceStatus {
            name: service_name.to_string(),
            label: label.to_string(),
            state: "N/A".to_string(),
            running: false,
            disabled: false,
        }
    }
}

#[tauri::command]
pub fn get_system_health(
    state: State<'_, PowerModulesState>,
) -> Result<SystemHealthReport, String> {
    let needs_prime = {
        let mut primed = state.cpu_primed.lock().map_err(|e| e.to_string())?;
        if !*primed {
            *primed = true;
            true
        } else {
            false
        }
    };

    let (cpu_usage_pct, cpu_cores, ram_used_bytes, ram_total_bytes) = {
        let mut sys = state.sys.lock().map_err(|e| e.to_string())?;
        if needs_prime {
            sys.refresh_cpu_usage();
            thread::sleep(Duration::from_millis(120));
        }
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        (
            sys.global_cpu_usage(),
            sys.cpus().len(),
            sys.used_memory(),
            sys.total_memory(),
        )
    };

    let uptime_secs = System::uptime();

    let disks_list = Disks::new_with_refreshed_list();
    let disks: Vec<DiskHealth> = disks_list
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| {
            let total = d.total_space();
            let avail = d.available_space();
            let used = total.saturating_sub(avail);
            DiskHealth {
                name: d.name().to_string_lossy().to_string(),
                mount_point: d.mount_point().to_string_lossy().to_string(),
                used_bytes: used,
                total_bytes: total,
                available_bytes: avail,
            }
        })
        .collect();

    let services = vec![
        query_windows_service("DiagTrack", "Telemetria (DiagTrack)"),
        query_windows_service("SysMain", "Superfetch (SysMain)"),
        query_windows_service("wuauserv", "Windows Update (wuauserv)"),
    ];

    Ok(SystemHealthReport {
        cpu_usage_pct,
        cpu_cores,
        ram_used_bytes,
        ram_total_bytes,
        uptime_secs,
        disks,
        services,
    })
}

// ============================================================================
// 3. Awake (`toggle_awake` -> SetThreadExecutionState)
// ============================================================================

fn apply_awake_execution_state(enabled: bool, keep_screen_on: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        };
        let flags = if enabled {
            if keep_screen_on {
                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
            } else {
                ES_CONTINUOUS | ES_SYSTEM_REQUIRED
            }
        } else {
            ES_CONTINUOUS
        };
        // SAFETY: `SetThreadExecutionState` is a standard Win32 power-management API taking a bitmask.
        let prev = unsafe { SetThreadExecutionState(flags) };
        if prev.0 == 0 {
            return Err("SetThreadExecutionState retornou falha (0).".to_string());
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (enabled, keep_screen_on);
        Ok(())
    }
}

#[tauri::command]
pub fn toggle_awake(
    app: AppHandle,
    state: State<'_, PowerModulesState>,
    keep_screen_on: bool,
    enabled: Option<bool>,
) -> Result<AwakeStatus, String> {
    let is_enabled = enabled.unwrap_or(keep_screen_on);
    apply_awake_execution_state(is_enabled, keep_screen_on)?;

    if let Ok(mut cfg) = state.config.lock() {
        cfg.awake_enabled = is_enabled;
        cfg.awake_keep_screen_on = keep_screen_on;
    }

    let sink = EventSink::Tauri(app);
    emit_log(
        &sink,
        "OK",
        1,
        if is_enabled {
            if keep_screen_on {
                "Awake ATIVADO (PC + Tela ligados via SetThreadExecutionState)."
            } else {
                "Awake ATIVADO (PC desperto, tela livre via SetThreadExecutionState)."
            }
        } else {
            "Awake DESATIVADO (energia restaurada para ES_CONTINUOUS)."
        },
    );

    Ok(AwakeStatus {
        enabled: is_enabled,
        keep_screen_on,
    })
}

// ============================================================================
// 4. Always on Top (`toggle_always_on_top`)
// ============================================================================

pub fn toggle_always_on_top_inner(app: &AppHandle) -> Result<AlwaysOnTopResult, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowLongW, GetWindowTextW, SetWindowPos, GWL_EXSTYLE,
            HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, WS_EX_TOPMOST,
        };

        // SAFETY: Querying and toggling the topmost flag on the active foreground HWND.
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return Err("Nenhuma janela em foco detectada.".to_string());
        }

        let mut title_buf = [0u16; 256];
        let len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
        let window_title = if len > 0 {
            String::from_utf16_lossy(&title_buf[..len as usize])
        } else {
            "Janela sem título".to_string()
        };

        let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        let currently_topmost = (ex_style & WS_EX_TOPMOST.0) != 0;
        let next_topmost = !currently_topmost;
        let insert_after = if next_topmost {
            HWND_TOPMOST
        } else {
            HWND_NOTOPMOST
        };

        unsafe {
            SetWindowPos(
                hwnd,
                insert_after,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE,
            )
        }
        .map_err(|e| format!("SetWindowPos falhou: {}", e))?;

        let result = AlwaysOnTopResult {
            window_title: window_title.clone(),
            is_topmost: next_topmost,
        };

        let sink = EventSink::Tauri(app.clone());
        let msg = format!(
            "Always on Top {}: \"{}\"",
            if next_topmost { "FIXADO" } else { "DESFIXADO" },
            window_title
        );
        emit_log(&sink, "OK", 1, &msg);
        let _ = app.emit(
            EVENT_POWERTOOL,
            PowerToolEventPayload {
                kind: "always-on-top".to_string(),
                message: msg,
                color: None,
                always_on_top: Some(result.clone()),
                ocr: None,
            },
        );

        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("toggle_always_on_top disponível apenas no Windows.".to_string())
    }
}

#[tauri::command]
pub fn toggle_always_on_top(app: AppHandle) -> Result<AlwaysOnTopResult, String> {
    toggle_always_on_top_inner(&app)
}

// ============================================================================
// 5. Color Picker (`pick_screen_color` -> GetCursorPos + GetDC + GetPixel + arboard)
// ============================================================================

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (u16, u8, u8) {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;

    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let l = (max + min) / 2.0;

    if (max - min).abs() < f64::EPSILON {
        return (0, 0, (l * 100.0).round() as u8);
    }

    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };

    let mut h = if (max - rf).abs() < f64::EPSILON {
        (gf - bf) / d + if gf < bf { 6.0 } else { 0.0 }
    } else if (max - gf).abs() < f64::EPSILON {
        (bf - rf) / d + 2.0
    } else {
        (rf - gf) / d + 4.0
    };
    h /= 6.0;

    (
        (h * 360.0).round() as u16 % 360,
        (s * 100.0).round() as u8,
        (l * 100.0).round() as u8,
    )
}

pub fn pick_screen_color_inner(app: &AppHandle) -> Result<PickedColor, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, POINT};
        use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC, CLR_INVALID};
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut pt = POINT { x: 0, y: 0 };
        // SAFETY: Standard Win32 screen pixel capture at current cursor coordinates.
        unsafe { GetCursorPos(&mut pt) }.map_err(|e| format!("GetCursorPos falhou: {}", e))?;

        let hdc = unsafe { GetDC(HWND::default()) };
        if hdc.is_invalid() {
            return Err("Não foi possível obter Device Context (GetDC) da tela.".to_string());
        }

        let color_ref = unsafe { GetPixel(hdc, pt.x, pt.y) };
        unsafe { ReleaseDC(HWND::default(), hdc) };

        if color_ref.0 == CLR_INVALID {
            return Err("GetPixel retornou CLR_INVALID na posição atual.".to_string());
        }

        let raw = color_ref.0;
        let r = (raw & 0xFF) as u8;
        let g = ((raw >> 8) & 0xFF) as u8;
        let b = ((raw >> 16) & 0xFF) as u8;

        let hex = format!("#{:02X}{:02X}{:02X}", r, g, b);
        let rgb = format!("rgb({}, {}, {})", r, g, b);
        let (h, s, l) = rgb_to_hsl(r, g, b);
        let hsl = format!("hsl({}, {}%, {}%)", h, s, l);

        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            let _ = clipboard.set_text(hex.clone());
        }

        let picked = PickedColor {
            hex: hex.clone(),
            rgb: rgb.clone(),
            hsl,
            r,
            g,
            b,
            x: pt.x,
            y: pt.y,
            timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
        };

        let sink = EventSink::Tauri(app.clone());
        let msg = format!(
            "Color Picker: {} ({}) copiado p/ clipboard ({}, {}).",
            hex, rgb, pt.x, pt.y
        );
        emit_log(&sink, "OK", 1, &msg);
        let _ = app.emit(
            EVENT_POWERTOOL,
            PowerToolEventPayload {
                kind: "color-picked".to_string(),
                message: msg,
                color: Some(picked.clone()),
                always_on_top: None,
                ocr: None,
            },
        );

        Ok(picked)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("pick_screen_color disponível apenas no Windows.".to_string())
    }
}

#[tauri::command]
pub fn pick_screen_color(app: AppHandle) -> Result<PickedColor, String> {
    pick_screen_color_inner(&app)
}

// ============================================================================
// 6. Paste as Plain Text (`paste_plain_text` -> arboard + SendInput Ctrl+V)
// ============================================================================

pub fn paste_plain_text_inner(app: &AppHandle) -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("Falha ao acessar clipboard: {}", e))?;
    let plain = clipboard
        .get_text()
        .map_err(|e| format!("Clipboard não contém texto puro: {}", e))?;

    // Re-writing as plain text clears HTML/RTF/rich formatting from clipboard
    clipboard
        .set_text(plain.clone())
        .map_err(|e| format!("Falha ao gravar texto sem formatação no clipboard: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT, VK_V,
        };

        fn key_ev(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        }

        // Brief pause so Ctrl+Alt+V physical Alt key doesn't collide with synthesized Ctrl+V
        thread::sleep(Duration::from_millis(45));

        let inputs = [
            key_ev(VK_MENU, KEYEVENTF_KEYUP),
            key_ev(VK_SHIFT, KEYEVENTF_KEYUP),
            key_ev(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            key_ev(VK_V, KEYBD_EVENT_FLAGS(0)),
            key_ev(VK_V, KEYEVENTF_KEYUP),
            key_ev(VK_CONTROL, KEYEVENTF_KEYUP),
        ];

        // SAFETY: Passing a valid contiguous slice of Win32 `INPUT` structs.
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    let preview: String = plain.chars().take(48).collect();
    let msg = format!(
        "Plain Text Paste: {} caractere(s) colado(s) sem formatação (\"{}\").",
        plain.chars().count(),
        preview.replace(['\r', '\n'], " ")
    );
    let sink = EventSink::Tauri(app.clone());
    emit_log(&sink, "OK", 1, &msg);
    let _ = app.emit(
        EVENT_POWERTOOL,
        PowerToolEventPayload {
            kind: "plain-text".to_string(),
            message: msg.clone(),
            color: None,
            always_on_top: None,
            ocr: None,
        },
    );

    Ok(plain)
}

#[tauri::command]
pub fn paste_plain_text(app: AppHandle) -> Result<String, String> {
    paste_plain_text_inner(&app)
}

// ============================================================================
// 7. Environment Variables Editor (`get_env_vars`, `save_env_var`, `delete_env_var`)
// ============================================================================

#[cfg(target_os = "windows")]
fn broadcast_environment_change() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let wide: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result: usize = 0;
    // SAFETY: Broadcasting standard `WM_SETTINGCHANGE` ("Environment") to top-level windows.
    unsafe {
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(wide.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            2000,
            Some(&mut result),
        );
    }
}

#[tauri::command]
pub fn get_env_vars() -> Result<Vec<EnvVarEntry>, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
        use winreg::RegKey;

        let mut list: Vec<EnvVarEntry> = Vec::new();

        if let Ok(hkcu_env) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", KEY_READ) {
            for item in hkcu_env.enum_values().flatten() {
                let (key, raw_val) = item;
                let value = match hkcu_env.get_value::<String, _>(&key) {
                    Ok(s) => s,
                    Err(_) => raw_val.to_string(),
                };
                list.push(EnvVarEntry {
                    scope: "user".to_string(),
                    key,
                    value,
                });
            }
        }

        if let Ok(hklm_env) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
            KEY_READ,
        ) {
            for item in hklm_env.enum_values().flatten() {
                let (key, raw_val) = item;
                let value = match hklm_env.get_value::<String, _>(&key) {
                    Ok(s) => s,
                    Err(_) => raw_val.to_string(),
                };
                list.push(EnvVarEntry {
                    scope: "system".to_string(),
                    key,
                    value,
                });
            }
        }

        list.sort_by(|a, b| {
            a.scope
                .cmp(&b.scope)
                .then_with(|| a.key.to_ascii_lowercase().cmp(&b.key.to_ascii_lowercase()))
        });
        Ok(list)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut list: Vec<EnvVarEntry> = std::env::vars()
            .map(|(key, value)| EnvVarEntry {
                scope: "user".to_string(),
                key,
                value,
            })
            .collect();
        list.sort_by(|a, b| a.key.to_ascii_lowercase().cmp(&b.key.to_ascii_lowercase()));
        Ok(list)
    }
}

#[tauri::command]
pub fn save_env_var(
    app: AppHandle,
    scope: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let clean_key = key.trim();
    if clean_key.is_empty() {
        return Err("Nome da variável de ambiente não pode estar vazio.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WRITE, RegType};
        use winreg::{RegKey, RegValue};

        let reg_key = match scope.to_ascii_lowercase().as_str() {
            "system" => RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey_with_flags(
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
                    KEY_WRITE,
                )
                .map_err(|e| {
                    format!(
                        "Permissão negada em HKLM\\Environment (execute como Administrador): {}",
                        e
                    )
                })?,
            _ => RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags("Environment", KEY_WRITE)
                .map_err(|e| format!("Falha ao abrir HKCU\\Environment: {}", e))?,
        };

        let use_expand = clean_key.eq_ignore_ascii_case("PATH") || value.contains('%');
        if use_expand {
            let mut bytes = Vec::with_capacity((value.len() + 1) * 2);
            for unit in value.encode_utf16().chain(std::iter::once(0u16)) {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            let reg_val = RegValue {
                bytes,
                vtype: RegType::REG_EXPAND_SZ,
            };
            reg_key
                .set_raw_value(clean_key, &reg_val)
                .map_err(|e| format!("Falha ao gravar '{}' (REG_EXPAND_SZ): {}", clean_key, e))?;
        } else {
            reg_key
                .set_value(clean_key, &value)
                .map_err(|e| format!("Falha ao gravar '{}': {}", clean_key, e))?;
        }

        broadcast_environment_change();

        let sink = EventSink::Tauri(app);
        emit_log(
            &sink,
            "OK",
            1,
            format!(
                "Variável [{}] '{}' atualizada e WM_SETTINGCHANGE transmitido.",
                scope.to_ascii_uppercase(),
                clean_key
            ),
        );
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, scope, value);
        Err("Edição de variáveis de ambiente no Registro disponível apenas no Windows.".to_string())
    }
}

#[tauri::command]
pub fn delete_env_var(app: AppHandle, scope: String, key: String) -> Result<(), String> {
    let clean_key = key.trim();
    if clean_key.is_empty() {
        return Err("Nome da variável vazio.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WRITE};
        use winreg::RegKey;

        let reg_key = match scope.to_ascii_lowercase().as_str() {
            "system" => RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey_with_flags(
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
                    KEY_WRITE,
                )
                .map_err(|e| {
                    format!(
                        "Permissão negada em HKLM\\Environment (execute como Administrador): {}",
                        e
                    )
                })?,
            _ => RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags("Environment", KEY_WRITE)
                .map_err(|e| format!("Falha ao abrir HKCU\\Environment: {}", e))?,
        };

        reg_key
            .delete_value(clean_key)
            .map_err(|e| format!("Falha ao remover variável '{}': {}", clean_key, e))?;

        broadcast_environment_change();

        let sink = EventSink::Tauri(app);
        emit_log(
            &sink,
            "WARN",
            1,
            format!(
                "Variável [{}] '{}' removida e WM_SETTINGCHANGE transmitido.",
                scope.to_ascii_uppercase(),
                clean_key
            ),
        );
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, scope);
        Err("Remoção de variáveis de ambiente disponível apenas no Windows.".to_string())
    }
}

// ============================================================================
// 8. Wintoys Reversible Tweaks (`get_wintoys_tweaks_status`, `apply_wintoys_tweak`)
// ============================================================================

fn read_tweak_live_state(tweak_id: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        match tweak_id {
            "classic_context_menu" => hkcu
                .open_subkey_with_flags(
                    r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32",
                    KEY_READ,
                )
                .is_ok(),
            "show_file_extensions" => hkcu
                .open_subkey_with_flags(
                    r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
                    KEY_READ,
                )
                .and_then(|k| k.get_value::<u32, _>("HideFileExt"))
                .map(|v| v == 0)
                .unwrap_or(false),
            "show_hidden_files" => hkcu
                .open_subkey_with_flags(
                    r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
                    KEY_READ,
                )
                .and_then(|k| k.get_value::<u32, _>("Hidden"))
                .map(|v| v == 1)
                .unwrap_or(false),
            "disable_bing_start" => {
                let pol = hkcu
                    .open_subkey_with_flags(
                        r"Software\Policies\Microsoft\Windows\Explorer",
                        KEY_READ,
                    )
                    .and_then(|k| k.get_value::<u32, _>("DisableSearchBoxSuggestions"))
                    .map(|v| v == 1)
                    .unwrap_or(false);
                let bing = hkcu
                    .open_subkey_with_flags(
                        r"Software\Microsoft\Windows\CurrentVersion\Search",
                        KEY_READ,
                    )
                    .and_then(|k| k.get_value::<u32, _>("BingSearchEnabled"))
                    .map(|v| v == 0)
                    .unwrap_or(false);
                pol || bing
            }
            "disable_telemetry_ads" => hkcu
                .open_subkey_with_flags(
                    r"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo",
                    KEY_READ,
                )
                .and_then(|k| k.get_value::<u32, _>("Enabled"))
                .map(|v| v == 0)
                .unwrap_or(false),
            "disable_mouse_accel" => hkcu
                .open_subkey_with_flags(r"Control Panel\Mouse", KEY_READ)
                .and_then(|k| k.get_value::<String, _>("MouseSpeed"))
                .map(|v| v.trim() == "0")
                .unwrap_or(false),
            "ultimate_performance_plan" => {
                let mut cmd = Command::new("powercfg");
                cmd.arg("/getactivescheme")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null());
                apply_no_window(&mut cmd);
                cmd.output()
                    .ok()
                    .map(|o| {
                        let out = String::from_utf8_lossy(&o.stdout).to_ascii_lowercase();
                        out.contains("ultimate performance")
                            || out.contains("desempenho máximo")
                            || out.contains("desempenho maximo")
                            || out.contains("e9a42b02-d5df-448d-aa00-03f14749eb61")
                    })
                    .unwrap_or(false)
            }
            "service_diagtrack" => query_windows_service("DiagTrack", "DiagTrack").disabled,
            "service_sysmain" => query_windows_service("SysMain", "SysMain").disabled,
            "service_wuauserv" => query_windows_service("wuauserv", "wuauserv").disabled,
            _ => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = tweak_id;
        false
    }
}

fn wintoys_catalog() -> Vec<(&'static str, &'static str, &'static str, &'static str)> {
    vec![
        (
            "classic_context_menu",
            "Explorer",
            "Menu de Contexto Clássico Win11",
            "Restaura o menu completo ao clicar com o botão direito",
        ),
        (
            "show_file_extensions",
            "Explorer",
            "Mostrar Extensões de Arquivo",
            "Exibe .exe, .json, .reg no Explorador (HideFileExt=0)",
        ),
        (
            "show_hidden_files",
            "Explorer",
            "Mostrar Arquivos Ocultos",
            "Exibe pastas e arquivos ocultos do sistema (Hidden=1)",
        ),
        (
            "disable_bing_start",
            "Privacy",
            "Desativar Bing & Sugestões no Iniciar",
            "Remove busca web/Bing e sugestões na barra Iniciar",
        ),
        (
            "disable_telemetry_ads",
            "Privacy",
            "Desativar ID de Anúncios",
            "Desativa AdvertisingInfo (HKCU AdvertisingInfo=0)",
        ),
        (
            "disable_mouse_accel",
            "Performance",
            "Desativar Aceleração do Mouse",
            "Desativa aprimorar precisão do ponteiro (MouseSpeed=0)",
        ),
        (
            "ultimate_performance_plan",
            "Performance",
            "Plano Desempenho Máximo",
            "Ativa Ultimate Performance via powercfg (reversível p/ Balanced)",
        ),
        (
            "service_diagtrack",
            "Services",
            "Desativar Telemetria (DiagTrack)",
            "Para e desativa o serviço Connected User Experiences",
        ),
        (
            "service_sysmain",
            "Services",
            "Desativar SysMain (Superfetch)",
            "Para e desativa pré-carregamento em disco/RAM",
        ),
        (
            "service_wuauserv",
            "Services",
            "Pausar Windows Update (wuauserv)",
            "Desativa temporariamente o serviço wuauserv",
        ),
    ]
}

#[tauri::command]
pub fn get_wintoys_tweaks_status() -> Result<Vec<WintoysTweakState>, String> {
    let items = wintoys_catalog()
        .into_iter()
        .map(|(id, category, label, description)| WintoysTweakState {
            id: id.to_string(),
            category: category.to_string(),
            label: label.to_string(),
            description: description.to_string(),
            enabled: read_tweak_live_state(id),
        })
        .collect();
    Ok(items)
}

#[cfg(target_os = "windows")]
fn find_ultimate_power_guid() -> Option<String> {
    let mut list_cmd = Command::new("powercfg");
    list_cmd
        .arg("/list")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_no_window(&mut list_cmd);

    let out = list_cmd
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())?;

    for line in out.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.contains("ultimate performance")
            || lower.contains("desempenho máximo")
            || lower.contains("desempenho maximo")
        {
            for token in line.split_whitespace() {
                if token.len() == 36 && token.chars().filter(|&c| c == '-').count() == 4 {
                    return Some(token.to_string());
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn toggle_windows_service(service: &str, disable: bool) -> Result<(), String> {
    let start_mode = if disable { "disabled" } else { "auto" };
    let mut cfg = Command::new("sc.exe");
    cfg.args(["config", service, "start=", start_mode])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cfg);
    let out = cfg
        .output()
        .map_err(|e| format!("Falha ao executar sc config {}: {}", service, e))?;
    if !out.status.success() {
        return Err(format!(
            "sc config {} falhou (execute como Administrador).",
            service
        ));
    }

    let action = if disable { "stop" } else { "start" };
    let mut act = Command::new("sc.exe");
    act.args([action, service])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut act);
    let _ = act.status();
    Ok(())
}

#[tauri::command]
pub fn apply_wintoys_tweak(
    app: AppHandle,
    tweak_id: String,
    enabled: bool,
) -> Result<WintoysTweakState, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        match tweak_id.as_str() {
            "classic_context_menu" => {
                if enabled {
                    let (key, _) = hkcu
                        .create_subkey(
                            r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32",
                        )
                        .map_err(|e| format!("Erro no Registro (Menu Clássico): {}", e))?;
                    key.set_value("", &"")
                        .map_err(|e| format!("Erro ao gravar valor padrão: {}", e))?;
                } else {
                    let _ = hkcu.delete_subkey_all(
                        r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}",
                    );
                }
            }
            "show_file_extensions" => {
                let (key, _) = hkcu
                    .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced")
                    .map_err(|e| format!("Erro no Registro (Explorer): {}", e))?;
                let val: u32 = if enabled { 0 } else { 1 };
                key.set_value("HideFileExt", &val)
                    .map_err(|e| format!("Erro ao gravar HideFileExt: {}", e))?;
            }
            "show_hidden_files" => {
                let (key, _) = hkcu
                    .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced")
                    .map_err(|e| format!("Erro no Registro (Explorer): {}", e))?;
                let val: u32 = if enabled { 1 } else { 2 };
                key.set_value("Hidden", &val)
                    .map_err(|e| format!("Erro ao gravar Hidden: {}", e))?;
            }
            "disable_bing_start" => {
                let (pol, _) = hkcu
                    .create_subkey(r"Software\Policies\Microsoft\Windows\Explorer")
                    .map_err(|e| format!("Erro no Registro (Policies\\Explorer): {}", e))?;
                let dis_val: u32 = if enabled { 1 } else { 0 };
                pol.set_value("DisableSearchBoxSuggestions", &dis_val)
                    .map_err(|e| format!("Erro ao gravar DisableSearchBoxSuggestions: {}", e))?;

                let (search, _) = hkcu
                    .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Search")
                    .map_err(|e| format!("Erro no Registro (Search): {}", e))?;
                let bing_val: u32 = if enabled { 0 } else { 1 };
                search
                    .set_value("BingSearchEnabled", &bing_val)
                    .map_err(|e| format!("Erro ao gravar BingSearchEnabled: {}", e))?;
            }
            "disable_telemetry_ads" => {
                let (key, _) = hkcu
                    .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo")
                    .map_err(|e| format!("Erro no Registro (AdvertisingInfo): {}", e))?;
                let val: u32 = if enabled { 0 } else { 1 };
                key.set_value("Enabled", &val)
                    .map_err(|e| format!("Erro ao gravar AdvertisingInfo: {}", e))?;
            }
            "disable_mouse_accel" => {
                let (key, _) = hkcu
                    .create_subkey(r"Control Panel\Mouse")
                    .map_err(|e| format!("Erro no Registro (Mouse): {}", e))?;
                if enabled {
                    key.set_value("MouseSpeed", &"0")
                        .map_err(|e| e.to_string())?;
                    key.set_value("MouseThreshold1", &"0")
                        .map_err(|e| e.to_string())?;
                    key.set_value("MouseThreshold2", &"0")
                        .map_err(|e| e.to_string())?;
                } else {
                    key.set_value("MouseSpeed", &"1")
                        .map_err(|e| e.to_string())?;
                    key.set_value("MouseThreshold1", &"6")
                        .map_err(|e| e.to_string())?;
                    key.set_value("MouseThreshold2", &"10")
                        .map_err(|e| e.to_string())?;
                }
            }
            "ultimate_performance_plan" => {
                if enabled {
                    let guid = match find_ultimate_power_guid() {
                        Some(g) => g,
                        None => {
                            let mut dup = Command::new("powercfg");
                            dup.args([
                                "-duplicatescheme",
                                "e9a42b02-d5df-448d-aa00-03f14749eb61",
                            ])
                            .stdout(Stdio::null())
                            .stderr(Stdio::null());
                            apply_no_window(&mut dup);
                            let _ = dup.status();
                            find_ultimate_power_guid()
                                .unwrap_or_else(|| "e9a42b02-d5df-448d-aa00-03f14749eb61".to_string())
                        }
                    };
                    let mut set = Command::new("powercfg");
                    set.args(["/setactive", &guid])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    apply_no_window(&mut set);
                    let status = set.status().map_err(|e| e.to_string())?;
                    if !status.success() {
                        return Err("Falha ao ativar plano Desempenho Máximo via powercfg.".to_string());
                    }
                } else {
                    // Balanced power scheme GUID
                    let mut set = Command::new("powercfg");
                    set.args(["/setactive", "381b4222-f694-41f0-9685-ff5bb260df2e"])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    apply_no_window(&mut set);
                    let _ = set.status();
                }
            }
            "service_diagtrack" => toggle_windows_service("DiagTrack", enabled)?,
            "service_sysmain" => toggle_windows_service("SysMain", enabled)?,
            "service_wuauserv" => toggle_windows_service("wuauserv", enabled)?,
            other => return Err(format!("Tweak Wintoys desconhecido: '{}'", other)),
        }

        let sink = EventSink::Tauri(app);
        let (_, category, label, description) = wintoys_catalog()
            .into_iter()
            .find(|(id, _, _, _)| *id == tweak_id)
            .unwrap_or(("custom", "System", "Tweak", ""));

        emit_log(
            &sink,
            "OK",
            1,
            format!(
                "Wintoys [{}]: {} -> {}",
                category,
                label,
                if enabled { "ATIVADO" } else { "DESATIVADO" }
            ),
        );

        Ok(WintoysTweakState {
            id: tweak_id.clone(),
            category: category.to_string(),
            label: label.to_string(),
            description: description.to_string(),
            enabled: read_tweak_live_state(&tweak_id),
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, tweak_id, enabled);
        Err("apply_wintoys_tweak disponível apenas no Windows.".to_string())
    }
}

// ============================================================================
// 9. Wintoys Quick Repairs (`run_wintoys_repair`)
// ============================================================================

#[tauri::command]
pub async fn run_wintoys_repair(app: AppHandle, repair_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sink = EventSink::Tauri(app);
        match repair_id.as_str() {
            "flush_dns" => {
                emit_log(&sink, "INFO", 1, "Wintoys Repair: executando ipconfig /flushdns...");
                let mut cmd = Command::new("ipconfig");
                cmd.arg("/flushdns")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                apply_no_window(&mut cmd);
                let out = cmd
                    .output()
                    .map_err(|e| format!("Falha ao rodar ipconfig: {}", e))?;
                if out.status.success() {
                    let msg = "Cache DNS limpo com sucesso (ipconfig /flushdns).".to_string();
                    emit_log(&sink, "OK", 1, &msg);
                    Ok(msg)
                } else {
                    Err("ipconfig /flushdns retornou erro.".to_string())
                }
            }
            "rebuild_icon_cache" => {
                emit_log(&sink, "WARN", 1, "Wintoys Repair: reconstruindo cache de ícones do Explorer...");
                let mut kill = Command::new("taskkill");
                kill.args(["/F", "/IM", "explorer.exe"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                apply_no_window(&mut kill);
                let _ = kill.status();

                thread::sleep(Duration::from_millis(350));

                let mut removed = 0usize;
                let local_app = PathBuf::from(resolve_windows_env_vars("%LOCALAPPDATA%"));
                let direct_db = local_app.join("IconCache.db");
                if direct_db.is_file() && fs::remove_file(&direct_db).is_ok() {
                    removed += 1;
                }

                let explorer_dir = local_app.join("Microsoft").join("Windows").join("Explorer");
                if let Ok(entries) = fs::read_dir(&explorer_dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                        if name.starts_with("iconcache") && name.ends_with(".db") {
                            if fs::remove_file(entry.path()).is_ok() {
                                removed += 1;
                            }
                        }
                    }
                }

                let _ = Command::new("explorer.exe").spawn();
                let msg = format!(
                    "Cache de ícones reconstruído ({} arquivo(s) .db removidos) e explorer.exe reiniciado.",
                    removed
                );
                emit_log(&sink, "OK", 1, &msg);
                Ok(msg)
            }
            "reset_network" => {
                emit_log(&sink, "INFO", 1, "Wintoys Repair: resetando pilha Winsock/TCP-IP + DNS...");
                for (prog, args) in [
                    ("netsh", vec!["winsock", "reset"]),
                    ("netsh", vec!["int", "ip", "reset"]),
                    ("ipconfig", vec!["/flushdns"]),
                ] {
                    let mut cmd = Command::new(prog);
                    cmd.args(&args)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    apply_no_window(&mut cmd);
                    let _ = cmd.status();
                }
                let msg = "Reset de rede concluído (Winsock + TCP/IP + DNS). Reinicie se necessário.".to_string();
                emit_log(&sink, "OK", 1, &msg);
                Ok(msg)
            }
            other => Err(format!("Reparo desconhecido: '{}'", other)),
        }
    })
    .await
    .map_err(|e| format!("Erro interno em run_wintoys_repair: {}", e))?
}

// ============================================================================
// 10. Global Hotkeys (`global-hotkey`) & PowerTools Configuration
// ============================================================================

fn parse_key_code(token: &str) -> Option<Code> {
    match token.trim().to_ascii_uppercase().as_str() {
        "A" => Some(Code::KeyA),
        "B" => Some(Code::KeyB),
        "C" => Some(Code::KeyC),
        "D" => Some(Code::KeyD),
        "E" => Some(Code::KeyE),
        "F" => Some(Code::KeyF),
        "G" => Some(Code::KeyG),
        "H" => Some(Code::KeyH),
        "I" => Some(Code::KeyI),
        "J" => Some(Code::KeyJ),
        "K" => Some(Code::KeyK),
        "L" => Some(Code::KeyL),
        "M" => Some(Code::KeyM),
        "N" => Some(Code::KeyN),
        "O" => Some(Code::KeyO),
        "P" => Some(Code::KeyP),
        "Q" => Some(Code::KeyQ),
        "R" => Some(Code::KeyR),
        "S" => Some(Code::KeyS),
        "T" => Some(Code::KeyT),
        "U" => Some(Code::KeyU),
        "V" => Some(Code::KeyV),
        "W" => Some(Code::KeyW),
        "X" => Some(Code::KeyX),
        "Y" => Some(Code::KeyY),
        "Z" => Some(Code::KeyZ),
        "0" => Some(Code::Digit0),
        "1" => Some(Code::Digit1),
        "2" => Some(Code::Digit2),
        "3" => Some(Code::Digit3),
        "4" => Some(Code::Digit4),
        "5" => Some(Code::Digit5),
        "6" => Some(Code::Digit6),
        "7" => Some(Code::Digit7),
        "8" => Some(Code::Digit8),
        "9" => Some(Code::Digit9),
        "F1" => Some(Code::F1),
        "F2" => Some(Code::F2),
        "F3" => Some(Code::F3),
        "F4" => Some(Code::F4),
        "F5" => Some(Code::F5),
        "F6" => Some(Code::F6),
        "F7" => Some(Code::F7),
        "F8" => Some(Code::F8),
        "F9" => Some(Code::F9),
        "F10" => Some(Code::F10),
        "F11" => Some(Code::F11),
        "F12" => Some(Code::F12),
        _ => None,
    }
}

fn parse_hotkey_string(spec: &str) -> Option<HotKey> {
    let mut mods = Modifiers::empty();
    let mut key_code: Option<Code> = None;

    for raw in spec.split('+') {
        let token = raw.trim().to_ascii_uppercase();
        if token.is_empty() {
            continue;
        }
        match token.as_str() {
            "CTRL" | "CONTROL" => mods |= Modifiers::CONTROL,
            "SHIFT" => mods |= Modifiers::SHIFT,
            "ALT" => mods |= Modifiers::ALT,
            "SUPER" | "WIN" | "META" => mods |= Modifiers::SUPER,
            other => {
                key_code = parse_key_code(other);
            }
        }
    }

    let code = key_code?;
    let mods_opt = if mods.is_empty() { None } else { Some(mods) };
    Some(HotKey::new(mods_opt, code))
}

/// Registers (or re-registers) active global hotkeys on the main UI thread.
fn sync_hotkeys_on_main_thread(
    config: &PowerToolsConfig,
    hotkey_map: &Arc<Mutex<RegisteredHotkeys>>,
) {
    MAIN_HOTKEY_MANAGER.with(|cell| {
        let mut mgr_opt = cell.borrow_mut();
        if mgr_opt.is_none() {
            match GlobalHotKeyManager::new() {
                Ok(mgr) => *mgr_opt = Some(mgr),
                Err(_) => return,
            }
        }
        let Some(ref mgr) = *mgr_opt else {
            return;
        };

        if let Ok(mut reg) = hotkey_map.lock() {
            for old_hk in reg.registered_keys.drain(..) {
                let _ = mgr.unregister(old_hk);
            }
            reg.action_by_id.clear();

            let specs = [
                (
                    config.always_on_top_enabled,
                    config.hotkey_always_on_top.as_str(),
                    "always_on_top",
                ),
                (
                    config.color_picker_enabled,
                    config.hotkey_color_picker.as_str(),
                    "color_picker",
                ),
                (
                    config.plain_text_enabled,
                    config.hotkey_plain_text.as_str(),
                    "plain_text",
                ),
                (
                    config.ocr_enabled,
                    config.hotkey_ocr.as_str(),
                    "ocr_capture",
                ),
            ];

            for (enabled, spec, action) in specs {
                if !enabled {
                    continue;
                }
                if let Some(hk) = parse_hotkey_string(spec) {
                    if mgr.register(hk).is_ok() {
                        reg.action_by_id.insert(hk.id(), action.to_string());
                        reg.registered_keys.push(hk);
                    }
                }
            }
        }
    });
}

/// Initializes the global hotkey manager on Tauri's main thread and spawns the event dispatch thread.
pub fn init_global_hotkeys(app: &AppHandle, state: &PowerModulesState) {
    let cfg_snapshot = state
        .config
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default();
    sync_hotkeys_on_main_thread(&cfg_snapshot, &state.hotkey_map);

    let app_handle = app.clone();
    let hotkey_map = Arc::clone(&state.hotkey_map);
    let config_arc = Arc::clone(&state.config);

    thread::spawn(move || {
        let receiver = GlobalHotKeyEvent::receiver();
        while let Ok(event) = receiver.recv() {
            if event.state != HotKeyState::Pressed {
                continue;
            }
            let action = hotkey_map
                .lock()
                .ok()
                .and_then(|map| map.action_by_id.get(&event.id).cloned());

            let Some(action_name) = action else {
                continue;
            };

            let cfg = config_arc
                .lock()
                .map(|c| c.clone())
                .unwrap_or_default();

            let res: Result<(), String> = match action_name.as_str() {
                "always_on_top" if cfg.always_on_top_enabled => {
                    toggle_always_on_top_inner(&app_handle).map(|_| ())
                }
                "color_picker" if cfg.color_picker_enabled => {
                    pick_screen_color_inner(&app_handle).map(|_| ())
                }
                "plain_text" if cfg.plain_text_enabled => {
                    paste_plain_text_inner(&app_handle).map(|_| ())
                }
                "ocr_capture" if cfg.ocr_enabled => open_ocr_overlay_inner(&app_handle),
                _ => Ok(()),
            };

            if let Err(err) = res {
                let sink = EventSink::Tauri(app_handle.clone());
                emit_log(&sink, "WARN", 1, format!("PowerTool [{}]: {}", action_name, err));
            }
        }
    });
}

#[tauri::command]
pub fn get_powertools_config(
    state: State<'_, PowerModulesState>,
) -> Result<PowerToolsConfig, String> {
    let cfg = state.config.lock().map_err(|e| e.to_string())?.clone();
    Ok(cfg)
}

#[tauri::command]
pub fn update_powertools_config(
    app: AppHandle,
    state: State<'_, PowerModulesState>,
    config: PowerToolsConfig,
) -> Result<PowerToolsConfig, String> {
    apply_awake_execution_state(config.awake_enabled, config.awake_keep_screen_on)?;

    HOOK_FIND_MY_MOUSE_ENABLED.store(config.find_my_mouse_enabled, Ordering::Relaxed);
    HOOK_REMAPPER_ENABLED.store(config.key_remapper_enabled, Ordering::Relaxed);

    {
        let mut guard = state.config.lock().map_err(|e| e.to_string())?;
        *guard = config.clone();
    }

    let _ = apply_mouse_crosshair_state(&app, &state.mouse_runtime, config.mouse_crosshair_enabled);

    let hotkey_map = Arc::clone(&state.hotkey_map);
    let cfg_clone = config.clone();
    let _ = app.run_on_main_thread(move || {
        sync_hotkeys_on_main_thread(&cfg_clone, &hotkey_map);
    });

    let sink = EventSink::Tauri(app);
    emit_log(
        &sink,
        "OK",
        1,
        format!(
            "PowerTools atualizados (Top: {}, Color: {}, Plain: {}, OCR: {}).",
            config.hotkey_always_on_top,
            config.hotkey_color_picker,
            config.hotkey_plain_text,
            config.hotkey_ocr
        ),
    );

    Ok(config)
}

// ============================================================================
// 11. Text Extractor — Native Windows 11 WinRT OCR (`open_ocr_overlay`, `extract_text_from_region`)
// ============================================================================

pub fn open_ocr_overlay_inner(app: &AppHandle) -> Result<(), String> {
    let app_clone = app.clone();
    app.run_on_main_thread(move || {
        if let Some(existing) = app_clone.get_webview_window("ocr-overlay") {
            let _ = existing.show();
            let _ = existing.set_focus();
            return;
        }

        let builder = WebviewWindowBuilder::new(
            &app_clone,
            "ocr-overlay",
            WebviewUrl::App("index.html?overlay=ocr".into()),
        )
        .title("WinForge OCR Capture")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .fullscreen(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .focused(true);

        if let Err(err) = builder.build() {
            let sink = EventSink::Tauri(app_clone.clone());
            emit_log(
                &sink,
                "ERR",
                1,
                format!("Falha ao abrir overlay OCR transparente: {}", err),
            );
        }
    })
    .map_err(|e| format!("Falha ao agendar janela OCR na thread principal: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn open_ocr_overlay(app: AppHandle) -> Result<(), String> {
    open_ocr_overlay_inner(&app)
}

#[cfg(target_os = "windows")]
fn capture_screen_region_bgra(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        HGDIOBJ, SRCCOPY,
    };

    if width <= 0 || height <= 0 {
        return Err("Dimensões da região OCR inválidas.".to_string());
    }

    // SAFETY: Standard Win32 GDI screen capture into a 32bpp top-down BGRA buffer,
    // releasing all GDI handles before returning.
    unsafe {
        let hdc_screen = GetDC(HWND::default());
        if hdc_screen.is_invalid() {
            return Err("GetDC(screen) falhou.".to_string());
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_invalid() {
            ReleaseDC(HWND::default(), hdc_screen);
            return Err("CreateCompatibleDC falhou.".to_string());
        }

        let hbitmap = CreateCompatibleBitmap(hdc_screen, width, height);
        if hbitmap.is_invalid() {
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(HWND::default(), hdc_screen);
            return Err("CreateCompatibleBitmap falhou.".to_string());
        }

        let old_obj = SelectObject(hdc_mem, HGDIOBJ(hbitmap.0));
        let blt_res = BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, x, y, SRCCOPY);

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down BGRA8
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };

        let byte_len = (width as usize)
            .saturating_mul(height as usize)
            .saturating_mul(4);
        let mut pixels = vec![0u8; byte_len];

        let scanlines = if blt_res.is_ok() {
            GetDIBits(
                hdc_mem,
                hbitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };

        SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(HGDIOBJ(hbitmap.0));
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(HWND::default(), hdc_screen);

        if let Err(e) = blt_res {
            return Err(format!("BitBlt falhou ao capturar tela: {}", e));
        }
        if scanlines == 0 {
            return Err("GetDIBits retornou 0 linhas capturadas.".to_string());
        }

        // GDI BitBlt leaves alpha byte as 0x00; mark fully opaque for WinRT SoftwareBitmap
        for px in pixels.chunks_exact_mut(4) {
            px[3] = 255;
        }

        Ok(pixels)
    }
}

#[cfg(target_os = "windows")]
fn run_winrt_ocr_bgra(bgra: &[u8], width: i32, height: i32) -> Result<String, String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let writer = DataWriter::new().map_err(|e| format!("DataWriter::new falhou: {}", e))?;
    writer
        .WriteBytes(bgra)
        .map_err(|e| format!("DataWriter::WriteBytes falhou: {}", e))?;
    let buffer = writer
        .DetachBuffer()
        .map_err(|e| format!("DataWriter::DetachBuffer falhou: {}", e))?;

    let bitmap =
        SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width, height)
            .map_err(|e| format!("SoftwareBitmap::CreateCopyFromBuffer falhou: {}", e))?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| {
        format!(
            "OcrEngine::TryCreateFromUserProfileLanguages indisponível (verifique pacote de idioma OCR do Windows 11): {}",
            e
        )
    })?;

    let ocr_result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("OcrEngine::RecognizeAsync falhou: {}", e))?
        .get()
        .map_err(|e| format!("Falha ao aguardar reconhecimento OCR: {}", e))?;

    let mut lines_out: Vec<String> = Vec::new();
    if let Ok(lines) = ocr_result.Lines() {
        for line in lines {
            if let Ok(txt) = line.Text() {
                let s = txt.to_string();
                if !s.trim().is_empty() {
                    lines_out.push(s);
                }
            }
        }
    }

    if !lines_out.is_empty() {
        Ok(lines_out.join("\n"))
    } else {
        Ok(ocr_result
            .Text()
            .map(|t| t.to_string())
            .unwrap_or_default())
    }
}

#[tauri::command]
pub async fn extract_text_from_region(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<OcrExtractResult, String> {
    if width < 4 || height < 4 {
        return Err("Região selecionada muito pequena para OCR (mínimo 4x4 px).".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            // Small delay so the hidden/closed overlay finishes compositing out of DWM
            thread::sleep(Duration::from_millis(75));

            let max_dim = 4000u32;
            let clamped_w = width.min(max_dim) as i32;
            let clamped_h = height.min(max_dim) as i32;

            let bgra = capture_screen_region_bgra(x, y, clamped_w, clamped_h)?;
            let text = run_winrt_ocr_bgra(&bgra, clamped_w, clamped_h)?;

            let trimmed = text.trim().to_string();
            if !trimmed.is_empty() {
                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                    let _ = clipboard.set_text(trimmed.clone());
                }
            }

            let line_count = if trimmed.is_empty() {
                0
            } else {
                trimmed.lines().count()
            };
            let char_count = trimmed.chars().count();

            let result = OcrExtractResult {
                text: trimmed.clone(),
                line_count,
                char_count,
                x,
                y,
                width: clamped_w as u32,
                height: clamped_h as u32,
                timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
            };

            let sink = EventSink::Tauri(app.clone());
            let msg = if trimmed.is_empty() {
                format!(
                    "Text Extractor (OCR): nenhum texto reconhecido na área {}x{} ({}, {}).",
                    clamped_w, clamped_h, x, y
                )
            } else {
                format!(
                    "Text Extractor (OCR): {} linha(s) / {} char(s) copiados para o clipboard.",
                    line_count, char_count
                )
            };
            emit_log(&sink, if trimmed.is_empty() { "WARN" } else { "OK" }, 1, &msg);
            let _ = app.emit(
                EVENT_POWERTOOL,
                PowerToolEventPayload {
                    kind: "ocr-extracted".to_string(),
                    message: msg,
                    color: None,
                    always_on_top: None,
                    ocr: Some(result.clone()),
                },
            );

            Ok(result)
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = (app, x, y, width, height);
            Err("Text Extractor (WinRT OcrEngine) disponível apenas no Windows 11.".to_string())
        }
    })
    .await
    .map_err(|e| format!("Erro interno em extract_text_from_region: {}", e))?
}

// ============================================================================
// 12. Visual Hosts File Editor (`read_hosts_file`, `save_hosts_file`)
// ============================================================================

fn hosts_file_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/etc/hosts")
    }
}

fn is_valid_hostname(domain: &str) -> bool {
    let d = domain.trim();
    if d.is_empty() || d.len() > 253 || d.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    for label in d.split('.') {
        if label.is_empty() || label.len() > 63 {
            return false;
        }
        if label.starts_with('-') || label.ends_with('-') {
            return false;
        }
        if !label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return false;
        }
    }
    true
}

/// Attempts to parse a single hosts line (active or commented `# IP domain ...`) into HostEntry items.
/// Returns `None` for blank lines or free-form descriptive comments.
fn parse_hosts_line(raw_line: &str, line_idx: usize) -> Option<Vec<HostEntry>> {
    let trimmed = raw_line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (enabled, body) = if let Some(rest) = trimmed.strip_prefix('#') {
        (false, rest.trim())
    } else {
        (true, trimmed)
    };

    if body.is_empty() {
        return None;
    }

    let (mapping_part, inline_comment) = match body.split_once('#') {
        Some((left, right)) => (left.trim(), right.trim().to_string()),
        None => (body, String::new()),
    };

    let mut tokens = mapping_part.split_whitespace();
    let ip_str = tokens.next()?;
    if ip_str.parse::<IpAddr>().is_err() {
        return None;
    }

    let domains: Vec<&str> = tokens.collect();
    if domains.is_empty() || !domains.iter().all(|d| is_valid_hostname(d)) {
        return None;
    }

    let entries = domains
        .into_iter()
        .enumerate()
        .map(|(dom_idx, domain)| HostEntry {
            id: format!("host_{}_{}", line_idx, dom_idx),
            ip: ip_str.to_string(),
            domain: domain.to_string(),
            comment: inline_comment.clone(),
            enabled,
        })
        .collect();

    Some(entries)
}

#[tauri::command]
pub fn read_hosts_file() -> Result<Vec<HostEntry>, String> {
    let path = hosts_file_path();
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Falha ao ler arquivo hosts ({}): {}", path.display(), e))?;

    let mut result: Vec<HostEntry> = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        if let Some(mut parsed) = parse_hosts_line(line, idx) {
            result.append(&mut parsed);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn save_hosts_file(app: AppHandle, entries: Vec<HostEntry>) -> Result<String, String> {
    // 1. Strict syntax validation before touching disk
    for (idx, entry) in entries.iter().enumerate() {
        let ip = entry.ip.trim();
        let domain = entry.domain.trim();
        if ip.parse::<IpAddr>().is_err() {
            return Err(format!(
                "Linha #{}: IP inválido ('{}'). Use IPv4 ou IPv6 válido.",
                idx + 1,
                ip
            ));
        }
        if !is_valid_hostname(domain) {
            return Err(format!(
                "Linha #{}: domínio inválido ('{}').",
                idx + 1,
                domain
            ));
        }
    }

    let path = hosts_file_path();
    let backup_path = path.with_file_name("hosts.bak");

    // 2. Preserve original free-form descriptive header comments
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut header_comments: Vec<String> = Vec::new();
    for (idx, line) in existing.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') && parse_hosts_line(line, idx).is_none() {
            header_comments.push(line.to_string());
        }
    }

    // 3. Automatic backup (`hosts.bak`)
    if path.exists() {
        fs::copy(&path, &backup_path).map_err(|e| {
            format!(
                "Falha ao criar backup automático {} (execute WinForge como Administrador): {}",
                backup_path.display(),
                e
            )
        })?;
    }

    // 4. Assemble clean hosts file content
    let mut out_lines: Vec<String> = Vec::new();
    if header_comments.is_empty() {
        out_lines.push("# Managed by WinForge Hosts Editor".to_string());
    } else {
        out_lines.extend(header_comments);
    }
    out_lines.push(String::new());

    for entry in &entries {
        let ip = entry.ip.trim();
        let domain = entry.domain.trim();
        let comment = entry.comment.trim();
        let prefix = if entry.enabled { "" } else { "# " };
        if comment.is_empty() {
            out_lines.push(format!("{}{}\t{}", prefix, ip, domain));
        } else {
            out_lines.push(format!("{}{}\t{}\t# {}", prefix, ip, domain, comment));
        }
    }

    #[cfg(target_os = "windows")]
    let line_ending = "\r\n";
    #[cfg(not(target_os = "windows"))]
    let line_ending = "\n";

    let mut rendered = out_lines.join(line_ending);
    rendered.push_str(line_ending);

    fs::write(&path, rendered).map_err(|e| {
        format!(
            "Permissão negada ao gravar {} (execute WinForge como Administrador): {}",
            path.display(),
            e
        )
    })?;

    let msg = format!(
        "Hosts salvo ({} entrada(s)) com backup automático em {}.",
        entries.len(),
        backup_path.display()
    );
    let sink = EventSink::Tauri(app);
    emit_log(&sink, "OK", 1, &msg);
    Ok(msg)
}

// ============================================================================
// 13. Batch Image Resizer & Converter (`batch_resize_images`)
// ============================================================================

#[tauri::command]
pub async fn batch_resize_images(
    app: AppHandle,
    paths: Vec<String>,
    width: u32,
    height: u32,
    format: String,
    quality: u8,
) -> Result<BatchResizeResult, String> {
    if paths.is_empty() {
        return Err("Nenhuma imagem selecionada para conversão.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        use image::codecs::jpeg::JpegEncoder;
        use image::imageops::FilterType;
        use image::ImageFormat;

        let sink = EventSink::Tauri(app);
        let fmt_lower = format.trim().to_ascii_lowercase();
        let (target_format, target_ext) = match fmt_lower.as_str() {
            "png" => (ImageFormat::Png, "png"),
            "jpg" | "jpeg" => (ImageFormat::Jpeg, "jpg"),
            "webp" => (ImageFormat::WebP, "webp"),
            other => {
                return Err(format!(
                    "Formato de saída não suportado: '{}'. Use PNG, JPG ou WEBP.",
                    other
                ));
            }
        };

        let clamped_quality = quality.clamp(1, 100);
        emit_log(
            &sink,
            "INFO",
            1,
            format!(
                "Batch Image Resizer: processando {} imagem(ns) -> {} ({}x{}, Q={})...",
                paths.len(),
                target_ext.to_ascii_uppercase(),
                width,
                height,
                clamped_quality
            ),
        );

        let mut succeeded: Vec<ResizedImageItem> = Vec::new();
        let mut failed: Vec<String> = Vec::new();

        for raw_path in paths {
            let src_path = PathBuf::from(raw_path.trim());
            let img = match image::open(&src_path) {
                Ok(i) => i,
                Err(e) => {
                    let msg = format!("{}: {}", src_path.display(), e);
                    emit_log(&sink, "ERR", 1, format!("Falha ao abrir imagem: {}", msg));
                    failed.push(msg);
                    continue;
                }
            };

            let orig_w = img.width();
            let orig_h = img.height();

            let resized = if width > 0 && height > 0 {
                img.resize(width, height, FilterType::Lanczos3)
            } else {
                img
            };

            let out_w = resized.width();
            let out_h = resized.height();

            let parent = src_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            let stem = src_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("image");

            let mut out_path = parent.join(format!("{}_{}x{}.{}", stem, out_w, out_h, target_ext));
            if out_path == src_path {
                out_path =
                    parent.join(format!("{}_{}x{}_out.{}", stem, out_w, out_h, target_ext));
            }

            let encode_res: Result<(), String> = match target_format {
                ImageFormat::Jpeg => {
                    let file_res = fs::File::create(&out_path)
                        .map_err(|e| format!("Falha ao criar {}: {}", out_path.display(), e));
                    match file_res {
                        Ok(mut file) => {
                            let rgb = resized.to_rgb8();
                            let mut encoder =
                                JpegEncoder::new_with_quality(&mut file, clamped_quality);
                            encoder
                                .encode_image(&rgb)
                                .map_err(|e| format!("Falha JPEG encode: {}", e))
                        }
                        Err(e) => Err(e),
                    }
                }
                ImageFormat::Png => resized
                    .save_with_format(&out_path, ImageFormat::Png)
                    .map_err(|e| format!("Falha PNG encode: {}", e)),
                ImageFormat::WebP => resized
                    .save_with_format(&out_path, ImageFormat::WebP)
                    .map_err(|e| format!("Falha WebP encode: {}", e)),
                _ => Err("Formato não suportado.".to_string()),
            };

            match encode_res {
                Ok(()) => {
                    let out_bytes = fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
                    succeeded.push(ResizedImageItem {
                        source_path: src_path.to_string_lossy().to_string(),
                        output_path: out_path.to_string_lossy().to_string(),
                        original_width: orig_w,
                        original_height: orig_h,
                        output_width: out_w,
                        output_height: out_h,
                        output_bytes: out_bytes,
                    });
                }
                Err(e) => {
                    let msg = format!("{}: {}", src_path.display(), e);
                    emit_log(&sink, "ERR", 1, &msg);
                    failed.push(msg);
                }
            }
        }

        emit_log(
            &sink,
            if failed.is_empty() { "OK" } else { "WARN" },
            1,
            format!(
                "Batch Image Resizer concluído: {} convertida(s), {} falha(s).",
                succeeded.len(),
                failed.len()
            ),
        );

        Ok(BatchResizeResult { succeeded, failed })
    })
    .await
    .map_err(|e| format!("Erro interno em batch_resize_images: {}", e))?
}

// ============================================================================
// 14. Mouse Utilities (Find My Mouse & Crosshair) + Simple Key Remapper (WH_KEYBOARD_LL)
// ============================================================================

const SPOTLIGHT_DURATION_MS: u64 = 3200;
const SPOTLIGHT_RADIUS_PX: u32 = 120;
const DOUBLE_CTRL_MIN_MS: u64 = 30;
const DOUBLE_CTRL_MAX_MS: u64 = 400;

#[cfg(target_os = "windows")]
const WINFORGE_INJECTED_TAG: usize = 0x5746_524D;

static HOOK_FIND_MY_MOUSE_ENABLED: AtomicBool = AtomicBool::new(true);
static HOOK_REMAPPER_ENABLED: AtomicBool = AtomicBool::new(true);
static MOUSE_TRACKER_RUNNING: AtomicBool = AtomicBool::new(false);
static LAST_CTRL_UP_MS: AtomicU64 = AtomicU64::new(0);
static CTRL_DOWN_CLEAN: AtomicBool = AtomicBool::new(false);

static HOOK_REMAP_TABLE: OnceLock<Mutex<HashMap<u16, u16>>> = OnceLock::new();
static HOOK_APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();
static HOOK_MOUSE_RUNTIME: OnceLock<Arc<Mutex<MouseOverlayRuntime>>> = OnceLock::new();

fn remap_table() -> &'static Mutex<HashMap<u16, u16>> {
    HOOK_REMAP_TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn key_name_to_vk(name: &str) -> Option<u16> {
    let key = name.trim().to_ascii_uppercase();
    match key.as_str() {
        "CAPSLOCK" | "CAPS" | "CAPS_LOCK" => Some(0x14),
        "ESCAPE" | "ESC" => Some(0x1B),
        "TAB" => Some(0x09),
        "SPACE" => Some(0x20),
        "ENTER" | "RETURN" => Some(0x0D),
        "BACKSPACE" | "BKSP" => Some(0x08),
        "DELETE" | "DEL" => Some(0x2E),
        "INSERT" | "INS" => Some(0x2D),
        "HOME" => Some(0x24),
        "END" => Some(0x23),
        "PAGEUP" | "PGUP" => Some(0x21),
        "PAGEDOWN" | "PGDN" => Some(0x22),
        "LEFT" => Some(0x25),
        "UP" => Some(0x26),
        "RIGHT" => Some(0x27),
        "DOWN" => Some(0x28),
        "LCONTROL" | "LCTRL" | "CTRL" => Some(0xA2),
        "RCONTROL" | "RCTRL" => Some(0xA3),
        "LSHIFT" | "SHIFT" => Some(0xA0),
        "RSHIFT" => Some(0xA1),
        "LALT" | "ALT" => Some(0xA4),
        "RALT" => Some(0xA5),
        "LWIN" | "WIN" | "SUPER" => Some(0x5B),
        "RWIN" => Some(0x5C),
        "APPS" | "MENU" => Some(0x5D),
        "PRINTSCREEN" | "PRTSC" => Some(0x2C),
        "SCROLLLOCK" => Some(0x91),
        "PAUSE" => Some(0x13),
        "NUMLOCK" => Some(0x90),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        s if s.len() == 1 => {
            let b = s.as_bytes()[0];
            if b.is_ascii_uppercase() || b.is_ascii_digit() {
                Some(b as u16)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn ensure_mouse_overlay_window(app: &AppHandle) {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        let win = if let Some(existing) = app_clone.get_webview_window("mouse-overlay") {
            let _ = existing.show();
            existing
        } else {
            let builder = WebviewWindowBuilder::new(
                &app_clone,
                "mouse-overlay",
                WebviewUrl::App("index.html?overlay=mouse".into()),
            )
            .title("WinForge Mouse Overlay")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .fullscreen(true)
            .resizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false);

            match builder.build() {
                Ok(w) => w,
                Err(_) => return,
            }
        };

        let _ = win.set_ignore_cursor_events(true);

        #[cfg(target_os = "windows")]
        {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{
                GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
                WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
            };

            if let Ok(raw_hwnd) = win.hwnd() {
                let hwnd = HWND(raw_hwnd.0 as usize as *mut std::ffi::c_void);
                // SAFETY: Applying click-through and no-activate extended styles to our own overlay HWND.
                unsafe {
                    let cur = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
                    let next = cur
                        | WS_EX_TRANSPARENT.0
                        | WS_EX_LAYERED.0
                        | WS_EX_TOOLWINDOW.0
                        | WS_EX_NOACTIVATE.0;
                    SetWindowLongW(hwnd, GWL_EXSTYLE, next as i32);
                }
            }
        }
    });
}

fn hide_mouse_overlay_window(app: &AppHandle) {
    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_clone.get_webview_window("mouse-overlay") {
            let _ = win.hide();
        }
    });
}

#[cfg(target_os = "windows")]
fn read_cursor_physical_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut pt = POINT { x: 0, y: 0 };
    // SAFETY: Standard Win32 cursor coordinate query.
    unsafe { GetCursorPos(&mut pt) }.ok()?;
    Some((pt.x, pt.y))
}

#[cfg(not(target_os = "windows"))]
fn read_cursor_physical_pos() -> Option<(i32, i32)> {
    None
}

fn start_mouse_overlay_tracker(app: AppHandle, runtime: Arc<Mutex<MouseOverlayRuntime>>) {
    if MOUSE_TRACKER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    ensure_mouse_overlay_window(&app);

    thread::spawn(move || {
        loop {
            let (spotlight_active, crosshair_active) = {
                let mut rt = match runtime.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                let spot = match rt.spotlight_until {
                    Some(until) if Instant::now() < until => true,
                    Some(_) => {
                        rt.spotlight_until = None;
                        false
                    }
                    None => false,
                };
                (spot, rt.crosshair_active)
            };

            if !spotlight_active && !crosshair_active {
                let _ = app.emit_to(
                    "mouse-overlay",
                    EVENT_MOUSE_OVERLAY,
                    MouseOverlayState {
                        x: -9999.0,
                        y: -9999.0,
                        spotlight_active: false,
                        crosshair_active: false,
                        spotlight_radius: SPOTLIGHT_RADIUS_PX,
                    },
                );
                hide_mouse_overlay_window(&app);
                break;
            }

            if let Some((px, py)) = read_cursor_physical_pos() {
                let (lx, ly) = if let Some(win) = app.get_webview_window("mouse-overlay") {
                    let scale = win.scale_factor().unwrap_or(1.0).max(0.5);
                    let origin = win
                        .outer_position()
                        .map(|p| (p.x, p.y))
                        .unwrap_or((0, 0));
                    (
                        (px - origin.0) as f64 / scale,
                        (py - origin.1) as f64 / scale,
                    )
                } else {
                    (px as f64, py as f64)
                };

                let _ = app.emit_to(
                    "mouse-overlay",
                    EVENT_MOUSE_OVERLAY,
                    MouseOverlayState {
                        x: lx,
                        y: ly,
                        spotlight_active,
                        crosshair_active,
                        spotlight_radius: SPOTLIGHT_RADIUS_PX,
                    },
                );
            }

            thread::sleep(Duration::from_millis(16));
        }

        MOUSE_TRACKER_RUNNING.store(false, Ordering::SeqCst);
    });
}

fn trigger_find_my_mouse_inner(app: &AppHandle, runtime: &Arc<Mutex<MouseOverlayRuntime>>) {
    let activated = {
        let mut rt = match runtime.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let already_active = rt
            .spotlight_until
            .map(|u| Instant::now() < u)
            .unwrap_or(false);
        if already_active {
            rt.spotlight_until = None;
            false
        } else {
            rt.spotlight_until = Some(Instant::now() + Duration::from_millis(SPOTLIGHT_DURATION_MS));
            true
        }
    };

    if activated {
        start_mouse_overlay_tracker(app.clone(), Arc::clone(runtime));
    }
}

fn apply_mouse_crosshair_state(
    app: &AppHandle,
    runtime: &Arc<Mutex<MouseOverlayRuntime>>,
    enabled: bool,
) -> Result<bool, String> {
    {
        let mut rt = runtime.lock().map_err(|e| e.to_string())?;
        rt.crosshair_active = enabled;
    }

    if enabled {
        start_mouse_overlay_tracker(app.clone(), Arc::clone(runtime));
    }

    Ok(enabled)
}

#[tauri::command]
pub fn trigger_find_my_mouse(
    app: AppHandle,
    state: State<'_, PowerModulesState>,
) -> Result<(), String> {
    trigger_find_my_mouse_inner(&app, &state.mouse_runtime);
    Ok(())
}

#[tauri::command]
pub fn set_mouse_crosshair(
    app: AppHandle,
    state: State<'_, PowerModulesState>,
    enabled: bool,
) -> Result<bool, String> {
    if let Ok(mut cfg) = state.config.lock() {
        cfg.mouse_crosshair_enabled = enabled;
    }
    apply_mouse_crosshair_state(&app, &state.mouse_runtime, enabled)?;

    let sink = EventSink::Tauri(app);
    emit_log(
        &sink,
        "OK",
        1,
        if enabled {
            "Mouse Crosshair ATIVADO (overlay click-through)."
        } else {
            "Mouse Crosshair DESATIVADO."
        },
    );

    Ok(enabled)
}

#[tauri::command]
pub fn sync_key_remaps(
    app: AppHandle,
    rules: Vec<KeyRemapRule>,
) -> Result<usize, String> {
    let mut next_map: HashMap<u16, u16> = HashMap::new();
    for rule in &rules {
        if !rule.enabled {
            continue;
        }
        if let (Some(from_vk), Some(to_vk)) =
            (key_name_to_vk(&rule.from_key), key_name_to_vk(&rule.to_key))
        {
            if from_vk != to_vk {
                next_map.insert(from_vk, to_vk);
            }
        }
    }

    let active_count = next_map.len();
    if let Ok(mut table) = remap_table().lock() {
        *table = next_map;
    }

    let sink = EventSink::Tauri(app);
    emit_log(
        &sink,
        "INFO",
        1,
        format!(
            "Key Remapper sincronizado: {} regra(s) ativa(s) no hook WH_KEYBOARD_LL.",
            active_count
        ),
    );

    Ok(active_count)
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn keyboard_hook_proc(
    n_code: i32,
    w_param: windows::Win32::Foundation::WPARAM,
    l_param: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, HHOOK, KBDLLHOOKSTRUCT, LLKHF_INJECTED, WM_KEYDOWN, WM_KEYUP,
        WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    if n_code >= 0 {
        let kb = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
        let is_injected =
            (kb.flags.0 & LLKHF_INJECTED.0) != 0 || kb.dwExtraInfo == WINFORGE_INJECTED_TAG;

        if !is_injected {
            let msg = w_param.0 as u32;
            let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            let vk = kb.vkCode as u16;

            // 1. Clean Double-Ctrl detection (< 400ms) for Find My Mouse
            let is_ctrl = vk == 0xA2 || vk == 0xA3 || vk == 0x11;
            if is_down {
                if is_ctrl {
                    CTRL_DOWN_CLEAN.store(true, Ordering::Relaxed);
                } else {
                    CTRL_DOWN_CLEAN.store(false, Ordering::Relaxed);
                }
            } else if is_up && is_ctrl && CTRL_DOWN_CLEAN.swap(false, Ordering::Relaxed) {
                if HOOK_FIND_MY_MOUSE_ENABLED.load(Ordering::Relaxed) {
                    let now = now_epoch_ms();
                    let prev = LAST_CTRL_UP_MS.swap(now, Ordering::Relaxed);
                    let delta = now.saturating_sub(prev);
                    if prev > 0 && (DOUBLE_CTRL_MIN_MS..=DOUBLE_CTRL_MAX_MS).contains(&delta) {
                        LAST_CTRL_UP_MS.store(0, Ordering::Relaxed);
                        if let (Some(app_lock), Some(runtime)) =
                            (HOOK_APP_HANDLE.get(), HOOK_MOUSE_RUNTIME.get())
                        {
                            if let Ok(Some(app_handle)) = app_lock.try_lock().map(|g| g.clone()) {
                                let rt_clone = Arc::clone(runtime);
                                thread::spawn(move || {
                                    trigger_find_my_mouse_inner(&app_handle, &rt_clone);
                                });
                            }
                        }
                    }
                }
            }

            // 2. Simple Key Remapper (try_lock avoids any blocking inside WH_KEYBOARD_LL)
            if (is_down || is_up) && HOOK_REMAPPER_ENABLED.load(Ordering::Relaxed) {
                let mapped_vk = remap_table()
                    .try_lock()
                    .ok()
                    .and_then(|table| table.get(&vk).copied());

                if let Some(target_vk) = mapped_vk {
                    let flags = if is_up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    };
                    let input = [INPUT {
                        r#type: INPUT_KEYBOARD,
                        Anonymous: INPUT_0 {
                            ki: KEYBDINPUT {
                                wVk: VIRTUAL_KEY(target_vk),
                                wScan: 0,
                                dwFlags: flags,
                                time: 0,
                                dwExtraInfo: WINFORGE_INJECTED_TAG,
                            },
                        },
                    }];
                    SendInput(&input, std::mem::size_of::<INPUT>() as i32);
                    return LRESULT(1);
                }
            }
        }
    }

    CallNextHookEx(HHOOK::default(), n_code, w_param, l_param)
}

/// Starts the dedicated low-level Windows keyboard hook thread (WH_KEYBOARD_LL)
/// powering Double-Ctrl Find My Mouse and the Simple Key Remapper.
pub fn init_keyboard_hook_thread(app: &AppHandle, state: &PowerModulesState) {
    let app_cell = HOOK_APP_HANDLE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = app_cell.lock() {
        *guard = Some(app.clone());
    }
    let _ = HOOK_MOUSE_RUNTIME.set(Arc::clone(&state.mouse_runtime));

    if let Ok(cfg) = state.config.lock() {
        HOOK_FIND_MY_MOUSE_ENABLED.store(cfg.find_my_mouse_enabled, Ordering::Relaxed);
        HOOK_REMAPPER_ENABLED.store(cfg.key_remapper_enabled, Ordering::Relaxed);
    }

    #[cfg(target_os = "windows")]
    {
        thread::spawn(move || {
            use windows::Win32::Foundation::{HINSTANCE, HWND};
            use windows::Win32::UI::WindowsAndMessaging::{
                DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
                UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL,
            };

            // SAFETY: Installing a process-wide WH_KEYBOARD_LL hook on a dedicated thread with a message pump.
            unsafe {
                let Ok(hook) = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(keyboard_hook_proc),
                    HINSTANCE::default(),
                    0,
                ) else {
                    return;
                };

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                let _ = UnhookWindowsHookEx(hook);
            }
        });
    }
}
