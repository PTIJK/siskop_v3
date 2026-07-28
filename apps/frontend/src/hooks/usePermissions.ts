import type { PermissionAction, PermissionModule } from "@siskop/types";
import { useAuth } from "@/stores/auth";

export function usePermissions() {
  const permissions = useAuth((s) => s.user?.permissions);

  const can = (module: PermissionModule, action: PermissionAction): boolean => {
    if (!permissions) return false;
    const modulePerms = permissions[module] as Record<string, boolean> | undefined;
    return modulePerms?.[action] ?? false;
  };

  const canAny = (module: PermissionModule, actions: PermissionAction[]): boolean => {
    return actions.some((a) => can(module, a));
  };

  return { can, canAny, permissions };
}
