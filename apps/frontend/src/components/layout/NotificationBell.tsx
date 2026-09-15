import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TenantNotification } from "@siskop/types";
import { apiFetchPage, apiPost } from "@/api/client";
import { formatTanggalIndonesia } from "@/lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Bell } from "lucide-react";

// A registration notification's relatedId points at a MemberRegistrationRequest —
// the queue lives in the "Pendaftaran Mandiri" tab of the Anggota page.
const ROUTE_BY_TYPE: Record<string, string> = {
  MEMBER_REGISTRATION_PENDING: "/members"
};

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetchPage<TenantNotification[]>("/notifications"),
    // A bell should feel live without the user reloading the page — this is
    // the only polling query in the app, deliberately: the alternative
    // (websockets/SSE) is more machinery than a review-queue count needs.
    refetchInterval: 30_000
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/notifications/${id}/read`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const items = data?.items ?? [];
  const unreadCount = data?.meta.unreadCount ?? 0;

  function onSelect(notification: TenantNotification) {
    if (!notification.read) markRead.mutate(notification.id);
    const route = ROUTE_BY_TYPE[notification.type];
    if (route) navigate(route);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifikasi</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">Tidak ada notifikasi</p>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex flex-col items-start gap-0.5 whitespace-normal"
              onClick={() => onSelect(n)}
            >
              <span className={n.read ? "text-sm text-muted-foreground" : "text-sm font-medium"}>{n.message}</span>
              <span className="text-xs text-muted-foreground">{formatTanggalIndonesia(new Date(n.createdAt))}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
