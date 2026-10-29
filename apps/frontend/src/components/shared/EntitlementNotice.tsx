import { LockedFeature } from "./LockedFeature";

interface EntitlementNoticeProps {
  message: string;
}

/** Shown in place of a module's content when its API call fails with FEATURE_NOT_ENTITLED — see middleware/entitlement.ts. */
export function EntitlementNotice({ message }: EntitlementNoticeProps) {
  return <LockedFeature variant="inline" featureName="Fitur ini" description={message} />;
}
