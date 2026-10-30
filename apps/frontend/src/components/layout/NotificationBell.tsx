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
        <Button
          variant="ghost"
          size="icon"
          aria-label={unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"}
          className="relative h-[38px] w-[38px] rounded-full border bg-card hover:bg-muted max-[900px]:h-11 max-[900px]:w-11"
        >
          <Bell aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background px-1 text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-2rem))]">
        <DropdownMenuLabel className="font-extrabold">Notifikasi</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Belum ada notifikasi. Pendaftaran anggota baru dan tugas lain muncul di sini.</p>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex min-h-[44px] flex-col items-start gap-0.5 whitespace-normal"
              onClick={() => onSelect(n)}
            >
              <span className={n.read ? "text-sm text-muted-foreground" : "text-sm font-bold"}>
                {!n.read && <span className="sr-only">Belum dibaca: </span>}
                {n.message}
              </span>
              <span className="text-xs text-muted-foreground">{formatTanggalIndonesia(new Date(n.createdAt))}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
