import { LockedFeature } from "./LockedFeature";

export function NotEntitledNotice({
  message = "Fitur ini tidak termasuk dalam paket langganan koperasi Anda. Hubungi admin platform untuk meng-upgrade paket."
}: {
  message?: string;
}) {
  return <LockedFeature variant="inline" featureName="Fitur ini" description={message} />;
}
