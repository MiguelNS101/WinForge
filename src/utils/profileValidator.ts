import { ValidationResult, WinForgeProfile } from '../types/profile';

export function validateProfileJson(raw: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sintaxe JSON inválida';
    return {
      valid: false,
      error: message,
      warnings: [],
    };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      error: 'A raiz do manifesto deve ser um objeto JSON válido.',
      warnings: [],
    };
  }

  const obj = data as Record<string, unknown>;
  const warnings: string[] = [];

  if (typeof obj.profile_name !== 'string' || !obj.profile_name.trim()) {
    return {
      valid: false,
      error: 'Campo obrigatório ausente ou inválido: "profile_name" (string).',
      warnings,
    };
  }

  if (typeof obj.author !== 'string') {
    warnings.push('Campo "author" ausente — será normalizado como "User".');
  }

  if (typeof obj.create_restore_point !== 'boolean') {
    warnings.push('Campo "create_restore_point" ausente — padrão definido para true.');
  }

  if (obj.system_tweaks !== undefined && !Array.isArray(obj.system_tweaks)) {
    return {
      valid: false,
      error: 'Campo "system_tweaks" deve ser um array.',
      warnings,
    };
  }

  if (obj.external_scripts !== undefined && !Array.isArray(obj.external_scripts)) {
    return {
      valid: false,
      error: 'Campo "external_scripts" deve ser um array.',
      warnings,
    };
  }

  if (obj.winget_packages !== undefined && !Array.isArray(obj.winget_packages)) {
    return {
      valid: false,
      error: 'Campo "winget_packages" deve ser um array.',
      warnings,
    };
  }

  if (obj.dotfiles !== undefined && (typeof obj.dotfiles !== 'object' || obj.dotfiles === null || Array.isArray(obj.dotfiles))) {
    return {
      valid: false,
      error: 'Campo "dotfiles" deve ser um objeto contendo "repo_url" e "mappings".',
      warnings,
    };
  }

  if (obj.registry_files !== undefined && !Array.isArray(obj.registry_files)) {
    return {
      valid: false,
      error: 'Campo "registry_files" deve ser um array.',
      warnings,
    };
  }

  const rawDotfiles = (obj.dotfiles as Record<string, unknown> | undefined) ?? {};
  const rawMappings = Array.isArray(rawDotfiles.mappings) ? rawDotfiles.mappings : [];

  const normalized: WinForgeProfile = {
    profile_name: obj.profile_name.trim(),
    author: typeof obj.author === 'string' && obj.author.trim() ? obj.author.trim() : 'User',
    create_restore_point: typeof obj.create_restore_point === 'boolean' ? obj.create_restore_point : true,
    system_tweaks: Array.isArray(obj.system_tweaks)
      ? obj.system_tweaks.map((item, idx) => {
          const t = (item ?? {}) as Record<string, unknown>;
          return {
            id: typeof t.id === 'string' && t.id ? t.id : `tweak_${idx + 1}`,
            label: typeof t.label === 'string' ? t.label : `Tweak #${idx + 1}`,
            enabled: typeof t.enabled === 'boolean' ? t.enabled : true,
            command: typeof t.command === 'string' ? t.command : '',
          };
        })
      : [],
    external_scripts: Array.isArray(obj.external_scripts)
      ? obj.external_scripts.map((item, idx) => {
          const s = (item ?? {}) as Record<string, unknown>;
          return {
            id: typeof s.id === 'string' && s.id ? s.id : `script_${idx + 1}`,
            label: typeof s.label === 'string' ? s.label : `Script #${idx + 1}`,
            enabled: typeof s.enabled === 'boolean' ? s.enabled : false,
            command: typeof s.command === 'string' ? s.command : '',
            interactive: typeof s.interactive === 'boolean' ? s.interactive : false,
          };
        })
      : [],
    winget_packages: Array.isArray(obj.winget_packages)
      ? obj.winget_packages.map((item, idx) => {
          const p = (item ?? {}) as Record<string, unknown>;
          const pre =
            typeof p.pre_cmd === 'string' && p.pre_cmd.trim() ? p.pre_cmd.trim() : undefined;
          const post =
            typeof p.post_cmd === 'string' && p.post_cmd.trim() ? p.post_cmd.trim() : undefined;
          return {
            id: typeof p.id === 'string' && p.id ? p.id : `Unknown.Package${idx + 1}`,
            name: typeof p.name === 'string' && p.name ? p.name : String(p.id ?? `Package ${idx + 1}`),
            category: typeof p.category === 'string' && p.category ? p.category : 'Geral',
            enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
            ...(pre ? { pre_cmd: pre } : {}),
            ...(post ? { post_cmd: post } : {}),
          };
        })
      : [],
    dotfiles: {
      repo_url: typeof rawDotfiles.repo_url === 'string' ? rawDotfiles.repo_url : '',
      mappings: rawMappings.map((item, idx) => {
        const m = (item ?? {}) as Record<string, unknown>;
        return {
          id: typeof m.id === 'string' && m.id ? m.id : `mapping_${idx + 1}`,
          label: typeof m.label === 'string' ? m.label : `Mapping #${idx + 1}`,
          source: typeof m.source === 'string' ? m.source : '',
          target: typeof m.target === 'string' ? m.target : '',
          kill_process: typeof m.kill_process === 'string' ? m.kill_process : '',
          enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
        };
      }),
    },
    registry_files: Array.isArray(obj.registry_files)
      ? obj.registry_files.map((item, idx) => {
          const r = (item ?? {}) as Record<string, unknown>;
          return {
            id: typeof r.id === 'string' && r.id ? r.id : `reg_${idx + 1}`,
            label: typeof r.label === 'string' ? r.label : `Registry #${idx + 1}`,
            path: typeof r.path === 'string' ? r.path : '',
            enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
          };
        })
      : [],
    bundle_root:
      typeof obj.bundle_root === 'string' && obj.bundle_root.trim()
        ? obj.bundle_root.trim()
        : undefined,
    vault_items: Array.isArray(obj.vault_items)
      ? obj.vault_items.map((item, idx) => {
          const v = (item ?? {}) as Record<string, unknown>;
          return {
            id: typeof v.id === 'string' && v.id ? v.id : `vault_${idx + 1}`,
            label: typeof v.label === 'string' ? v.label : `Vault #${idx + 1}`,
            source_path: typeof v.source_path === 'string' ? v.source_path : '',
            bundle_subpath:
              typeof v.bundle_subpath === 'string' && v.bundle_subpath
                ? v.bundle_subpath
                : `vault/item_${idx + 1}`,
            enabled: typeof v.enabled === 'boolean' ? v.enabled : true,
          };
        })
      : [],
    vscode_extensions: Array.isArray(obj.vscode_extensions)
      ? obj.vscode_extensions
          .filter((ext): ext is string => typeof ext === 'string' && ext.trim().length > 0)
          .map((ext) => ext.trim())
      : [],
    portable_apps: Array.isArray(obj.portable_apps)
      ? obj.portable_apps.map((item, idx) => {
          const p = (item ?? {}) as Record<string, unknown>;
          const pre =
            typeof p.pre_cmd === 'string' && p.pre_cmd.trim() ? p.pre_cmd.trim() : undefined;
          const post =
            typeof p.post_cmd === 'string' && p.post_cmd.trim() ? p.post_cmd.trim() : undefined;
          return {
            id: typeof p.id === 'string' && p.id ? p.id : `portable_${idx + 1}`,
            name: typeof p.name === 'string' ? p.name : `Portable App #${idx + 1}`,
            zip_url: typeof p.zip_url === 'string' ? p.zip_url : '',
            extract_to: typeof p.extract_to === 'string' ? p.extract_to : '',
            add_to_path: typeof p.add_to_path === 'boolean' ? p.add_to_path : false,
            enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
            ...(pre ? { pre_cmd: pre } : {}),
            ...(post ? { post_cmd: post } : {}),
          };
        })
      : [],
    backup_wifi: typeof obj.backup_wifi === 'boolean' ? obj.backup_wifi : false,
    backup_drivers: typeof obj.backup_drivers === 'boolean' ? obj.backup_drivers : false,
    extra_save_paths: Array.isArray(obj.extra_save_paths)
      ? obj.extra_save_paths
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => s.trim())
      : [],
    autostart_tasks: Array.isArray(obj.autostart_tasks)
      ? obj.autostart_tasks.map((item, idx) => {
          const a = (item ?? {}) as Record<string, unknown>;
          return {
            name:
              typeof a.name === 'string' && a.name.trim()
                ? a.name.trim()
                : `Autostart #${idx + 1}`,
            exe_path: typeof a.exe_path === 'string' ? a.exe_path.trim() : '',
            args: typeof a.args === 'string' ? a.args.trim() : '',
            run_as_admin: typeof a.run_as_admin === 'boolean' ? a.run_as_admin : false,
            enabled: typeof a.enabled === 'boolean' ? a.enabled : true,
          };
        })
      : [],
    key_remaps: Array.isArray(obj.key_remaps)
      ? obj.key_remaps
          .map((item) => {
            const k = (item ?? {}) as Record<string, unknown>;
            return {
              from_key: typeof k.from_key === 'string' ? k.from_key.trim() : '',
              to_key: typeof k.to_key === 'string' ? k.to_key.trim() : '',
              enabled: typeof k.enabled === 'boolean' ? k.enabled : true,
            };
          })
          .filter((r) => r.from_key.length > 0 && r.to_key.length > 0)
      : [],
  };

  return {
    valid: true,
    warnings,
    parsed: normalized,
  };
}
