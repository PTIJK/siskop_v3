import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatTanggalPendek } from '../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Bell, Building2 } from 'lucide-react';

interface NotificationItem {
  id: string;
  type: 'TENANT_REGISTERED' | 'BILLING_BLOCKED' | 'PACKAGE_CHANGED';
  title: string;
  message: string;
  relatedTenant?: { id: string; name: string; slug: string } | null;
  isRead: boolean;
  createdAt: string;
}

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const fetchUnreadCount = () => {
    api.get('/api/admin/notifications/unread-count')
      .then((res) => setUnreadCount(res.data.data.count))
      .catch(() => {});
  };

  const fetchList = () => {
    setIsLoading(true);
    api.get('/api/admin/notifications', { params: { page: 1, limit: 20 } })
      .then((res) => setItems(res.data.data))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (open) fetchList();
  }, [open]);

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.isRead) {
      await api.post(`/api/admin/notifications/${item.id}/read`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isRead: true } : i)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (item.relatedTenant) {
      setOpen(false);
      navigate(`/admin/tenants/${item.relatedTenant.id}`);
    }
  };

  const markAllRead = async () => {
    await api.post('/api/admin/notifications/read-all');
    setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
    setUnreadCount(0);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifikasi</p>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-primary hover:underline"
            >
              Tandai semua dibaca
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Memuat...</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Belum ada notifikasi</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                onClick={() => handleItemClick(item)}
                className={`flex w-full items-start gap-2 border-b px-3 py-2.5 text-left last:border-0 hover:bg-muted ${
                  item.isRead ? '' : 'bg-violet-50/60'
                }`}
              >
                <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {!item.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600" />}
                    <p className="truncate text-xs font-medium">{item.title}</p>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{formatTanggalPendek(item.createdAt)}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
