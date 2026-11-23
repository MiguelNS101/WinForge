// Prevents additional console window on Windows in release GUI mode, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::process;

#[cfg(target_os = "windows")]
fn attach_parent_console() {
    use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    // SAFETY: Attaching to the parent process console (if invoked from PowerShell/CMD)
    // enables stdout/stderr output when built with `windows_subsystem = "windows"`.
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(target_os = "windows"))]
fn attach_parent_console() {}

fn print_cli_help() {
    println!("WinForge — Provisionador Universal Pós-Formatação (CLI / GUI)");
    println!();
    println!("USO:");
    println!("  WinForge.exe                              Abre a interface gráfica");
    println!("  WinForge.exe --deploy <profile.json>      Executa o provisionamento headless");
    println!("  WinForge.exe --deploy <profile.json> --dry-run");
    println!("                                            Valida bundle, WinGet e URLs sem alterar o sistema");
    println!("  WinForge.exe --harvest <pasta_destino>    Gera bundle portátil pré-formatação headless");
    println!("    Opções de --harvest:");
    println!("      --drivers                             Inclui backup de drivers (pnputil)");
    println!("      --no-wifi                             Ignora exportação de perfis Wi-Fi");
}

fn try_run_cli() -> Option<i32> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        return None;
    }

    let mut deploy_path: Option<String> = None;
    let mut harvest_dir: Option<String> = None;
    let mut dry_run = false;
    let mut backup_wifi = true;
    let mut backup_drivers = false;
    let mut show_help = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--deploy" => {
                if let Some(path) = args.get(i + 1) {
                    deploy_path = Some(path.clone());
                    i += 2;
                    continue;
                } else {
                    attach_parent_console();
                    eprintln!("[WINFORGE] Erro: --deploy exige <caminho_do_json>.");
                    return Some(2);
                }
            }
            "--harvest" => {
                if let Some(dir) = args.get(i + 1) {
                    harvest_dir = Some(dir.clone());
                    i += 2;
                    continue;
                } else {
                    attach_parent_console();
                    eprintln!("[WINFORGE] Erro: --harvest exige <pasta_destino>.");
                    return Some(2);
                }
            }
            "--dry-run" => {
                dry_run = true;
            }
            "--drivers" => {
                backup_drivers = true;
            }
            "--no-wifi" => {
                backup_wifi = false;
            }
            "--help" | "-h" => {
                show_help = true;
            }
            _ => {}
        }
        i += 1;
    }

    if !show_help && deploy_path.is_none() && harvest_dir.is_none() {
        return None;
    }

    attach_parent_console();

    if show_help {
        print_cli_help();
        return Some(0);
    }

    if let Some(json_path) = deploy_path {
        return match winforge_lib::run_cli_deploy(&json_path, dry_run) {
            Ok(()) => Some(0),
            Err(err) => {
                println!("[WINFORGE] [ERR] {}", err);
                Some(1)
            }
        };
    }

    if let Some(output_dir) = harvest_dir {
        return match winforge_lib::run_cli_harvest(&output_dir, backup_wifi, backup_drivers) {
            Ok(()) => Some(0),
            Err(err) => {
                println!("[WINFORGE] [ERR] {}", err);
                Some(1)
            }
        };
    }

    None
}

fn main() {
    if let Some(exit_code) = try_run_cli() {
        process::exit(exit_code);
    }

    winforge_lib::run();
}
