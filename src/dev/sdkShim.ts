import type {
  PluginPermission,
  PrivilegiertePluginPermission,
  SidelineBackendPlugin,
  SidelinePlugin,
} from '@sidelineos/plugin-sdk';

export const SIDELINE_SDK_VERSION = '2.0' as const;

export const PRIVILEGIERTE_CAPABILITIES: readonly PrivilegiertePluginPermission[] = [
  'storage:provider',
  'core:org-manage',
  'core:users-manage',
  'core:plugins-manage',
  'core:storage-quota-manage',
  'core:storage-nodes-manage',
  'dev:git-install',
] as const;

export function istPrivilegierteCapability(
  permission: PluginPermission
): permission is PrivilegiertePluginPermission {
  return (PRIVILEGIERTE_CAPABILITIES as readonly string[]).includes(permission);
}

export function definierePlugin(plugin: SidelinePlugin): SidelinePlugin {
  return plugin;
}

export function definiereBackendPlugin(plugin: SidelineBackendPlugin): SidelineBackendPlugin {
  return plugin;
}
