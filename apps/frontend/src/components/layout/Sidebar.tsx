import { NavLink } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../stores/authStore';
import {
  LayoutDashboard, Users, PiggyBank, CreditCard,
  FileText, Settings, AlertTriangle, Building2, X, Menu,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { TenantType } from '@siskop/shared';

const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    module: 'dashboard' as const,
    action: 'read' as const,
  },
  {
    label: 'Anggota',
    href: '/members',
    icon: Users,
    module: 'members' as const,
    action: 'read' as const,
  },
  {
    label: 'Simpanan',
    href: '/savings',
    icon: PiggyBank,
    module: 'savings' as const,
    action: 'read' as const,
  },
  {
    label: 'Pinjaman',
    href: '/loans',
    icon: CreditCard,
    module: 'loans' as const,
    action: 'read' as const,
    children: [
      { label: 'Semua Pinjaman', href: '/loans' },
      { label: 'Anggota Menunggak', href: '/loans/overdue', icon: AlertTriangle },
    ],
  },
  {
    label: 'Laporan',
    href: '/reports',
    icon: FileText,
    module: 'reports' as const,
    action: 'read' as const,
  },
];

function buildConfigItem(whitelabelEnabled: boolean) {
  return {
    label: 'Konfigurasi',
    href: '/config/profile',
    icon: Settings,
    module: 'config' as const,
    action: 'read' as const,
    children: [
      { label: 'Profil', href: '/config/profile' },
      { label: 'Konfigurasi Simpanan', href: '/config/savings' },
      { label: 'Konfigurasi Pinjaman', href: '/config/loans' },
      { label: 'Pengguna', href: '/config/users' },
      { label: 'Hak Akses', href: '/config/roles' },
      ...(whitelabelEnabled ? [{ label: 'Whitelabel', href: '/config/whitelabel' }] : []),
    ],
  };
}

interface NavItemWithChildren {
  label: string;
  href: string;
  icon: React.ElementType;
  module: 'dashboard' | 'members' | 'savings' | 'loans' | 'reports' | 'config' | 'users' | 'roles';
  action: 'read';
  children?: { label: string; href: string; icon?: React.ElementType }[];
}

function NavItemComponent({ item, onClose }: { item: NavItemWithChildren; onClose?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <svg
            className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="ml-4 mt-1 space-y-1 border-l border-slate-700 pl-3">
            {item.children.map((child) => (
              <NavLink
                key={child.href}
                to={child.href}
                end={child.href === item.href}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'border-l-2 border-primary bg-slate-700 text-white'
                      : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                  )
                }
              >
                {child.icon && <child.icon className="h-3 w-3" />}
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.href}
      end
      onClick={onClose}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'border-l-2 border-primary bg-slate-700 text-white'
            : 'text-slate-300 hover:bg-slate-700 hover:text-white'
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const { can } = usePermissions();
  const tenant = useAuthStore((s) => s.tenant);
  const configItem = buildConfigItem(Boolean(tenant?.package?.whitelabelEnabled));

  return (
    <div className="flex h-full flex-col bg-slate-900">
      {/* Logo area */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Building2 className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{tenant?.name ?? 'SISKOP'}</p>
            <p className="text-xs text-slate-400">
              {tenant?.type === TenantType.SYARIAH ? 'Syariah' : 'Konvensional'}
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white lg:hidden">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          if (!can(item.module, item.action)) return null;
          return (
            <NavItemComponent
              key={item.href}
              item={item as unknown as NavItemWithChildren}
              onClose={onClose}
            />
          );
        })}
      </nav>

      {/* Config at bottom */}
      {can(configItem.module, configItem.action) && (
        <div className="border-t border-slate-700 px-3 py-4">
          <NavItemComponent
            item={configItem as unknown as NavItemWithChildren}
            onClose={onClose}
          />
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed left-4 top-4 z-50 rounded-md bg-slate-900 p-2 text-white lg:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <SidebarContent onClose={() => setMobileOpen(false)} />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden w-64 shrink-0 lg:block">
        <SidebarContent />
      </div>
    </>
  );
}
