import { WinForgeProfile } from '../types/profile';

/**
 * Clean, data-driven empty manifesto initialized when no local `profile.json`
 * is found next to `WinForge.exe`. Contains zero hardcoded apps, scripts, or mock repos;
 * only standard Windows profile configuration paths for `[00] HARVEST`.
 */
export const EMPTY_PROFILE: WinForgeProfile = {
  profile_name: 'Novo Perfil',
  author: '',
  create_restore_point: true,
  system_tweaks: [],
  external_scripts: [],
  winget_packages: [],
  dotfiles: {
    repo_url: '',
    mappings: [],
  },
  registry_files: [],
  bundle_root: 'D:\\WinForge_Bundle_2026',
  vault_items: [
    {
      id: 'ssh_keys',
      label: 'Chaves SSH (~/.ssh)',
      source_path: '%USERPROFILE%\\.ssh',
      bundle_subpath: 'vault/ssh',
      enabled: true,
    },
    {
      id: 'gitconfig',
      label: 'Git Config (~/.gitconfig)',
      source_path: '%USERPROFILE%\\.gitconfig',
      bundle_subpath: 'vault/gitconfig',
      enabled: true,
    },
    {
      id: 'npmrc',
      label: 'NPM Config (~/.npmrc)',
      source_path: '%USERPROFILE%\\.npmrc',
      bundle_subpath: 'vault/npmrc',
      enabled: true,
    },
    {
      id: 'windows_terminal',
      label: 'Windows Terminal Settings',
      source_path:
        '%LOCALAPPDATA%\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json',
      bundle_subpath: 'vault/windows-terminal',
      enabled: true,
    },
  ],
  vscode_extensions: [],
  portable_apps: [],
  backup_wifi: true,
  backup_drivers: false,
  extra_save_paths: [],
  autostart_tasks: [],
  key_remaps: [],
};
