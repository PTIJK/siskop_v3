import { Info } from "lucide-react";
import { Card, CardContent } from "../ui/card";

export function NotEntitledNotice({
  message = "Fitur ini tidak termasuk dalam paket langganan koperasi Anda. Hubungi admin platform untuk meng-upgrade paket."
}: {
  message?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-6 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{message}</p>
      </CardContent>
    </Card>
  );
}
