import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useAuth } from '../../hooks/useAuth';
import { AdminSidebar } from './AdminSidebar';
import { NotificationBell } from './NotificationBell';
import { Toaster } from '../ui/toaster';
import { Avatar, AvatarFallback } from '../ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Badge } from '../ui/badge';
import { LogOut, ChevronDown, Shield } from 'lucide-react';

const ADMIN_ROUTE_LABELS: Record<string, string> = {
  '/admin': 'Dashboard Platform',
  '/admin/tenants': 'Koperasi',
  '/admin/packages': 'Paket Langganan',
  '/admin/users': 'Platform Admin',
};

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function AdminTopbar() {
  const { user } = useAuthStore();
  const { logout } = useAuth();
  const location = useLocation();

  const pageTitle =
    Object.entries(ADMIN_ROUTE_LABELS).find(
      ([path]) => location.pathname === path || location.pathname.startsWith(path + '/')
    )?.[1] ?? 'Admin';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 lg:px-6">
      <div className="pl-10 lg:pl-0">
        <h1 className="text-base font-semibold text-foreground">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="hidden items-center gap-1 sm:flex">
          <Shield className="h-3 w-3" />
          Platform Admin
        </Badge>

        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs bg-violet-100 text-violet-700">
                {user ? getInitials(user.name) : 'SA'}
              </AvatarFallback>
            </Avatar>
            <div className="hidden flex-col items-start sm:flex">
              <span className="text-xs font-medium">{user?.name ?? 'Admin'}</span>
              <span className="text-xs text-muted-foreground">{user?.email ?? ''}</span>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="flex items-center gap-2 text-sm">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs bg-violet-100 text-violet-700">
                  {user ? getInitials(user.name) : 'SA'}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="flex items-center gap-2 text-sm text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function AdminLayout() {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Memuat...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user?.isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminTopbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
