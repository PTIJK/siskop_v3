import { useAuthStore } from '../stores/authStore';
import { Permissions } from '@siskop/shared';

type Module = keyof Permissions;
type Action = 'create' | 'read' | 'update' | 'delete' | 'export';

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.role?.permissions as Permissions | undefined;

  const can = (module: Module, action: Action): boolean => {
    if (!permissions) return false;
    const modulePerms = permissions[module] as Record<string, boolean> | undefined;
    return modulePerms?.[action] ?? false;
  };

  const canAny = (module: Module, actions: Action[]): boolean => {
    return actions.some((a) => can(module, a));
  };

  return { can, canAny, permissions };
}
