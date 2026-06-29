import { Request, Response, NextFunction } from 'express';
import { Permissions } from '@siskop/shared';

type Module = keyof Permissions;
type Action = 'create' | 'read' | 'update' | 'delete' | 'export';

export function requirePermission(module: Module, action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const permissions = req.user?.role?.permissions as unknown as Permissions;

    if (!permissions) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Tidak memiliki izin' },
      });
      return;
    }

    const modulePerms = permissions[module] as Record<string, boolean>;
    if (!modulePerms?.[action]) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Tidak memiliki izin ${action} pada modul ${module}`,
        },
      });
      return;
    }

    next();
  };
}
