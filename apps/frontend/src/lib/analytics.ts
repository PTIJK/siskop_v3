import posthog, { type CaptureResult } from "posthog-js";

/**
 * Landing-page analytics (PostHog, EU). Anonymous by design: no cookies
 * (memory persistence), no person profiles, no session recording, no autocapture.
 * Never pass names, emails, phone numbers or form values to `track`.
 */
export type CtaLocation = "navbar" | "hero" | "pricing" | "footer" | "cta" | "partner";
export type EventName = "cta_demo_click" | "cta_signup_click" | "cta_pricing_click" | "form_submit";
type Props = Record<string, string | number | boolean>;

// Only campaign and funnel params survive; anything else (tenant/membership ids,
// tokens) is stripped from URLs before they leave the browser.
const KEPT_PARAMS = /^(utm_[a-z_]+|ref|package|cycle|gclid|fbclid)$/;

export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (!KEPT_PARAMS.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw;
  }
}

let ready = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (ready || !key) return;
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com",
    person_profiles: "identified_only",
    persistence: "memory",
    capture_pageview: "history_change", // SPA: also fires on router pushState
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    before_send: (event: CaptureResult | null) => {
      const props = event?.properties;
      if (props && typeof props.$current_url === "string") props.$current_url = sanitizeUrl(props.$current_url);
      return event;
    }
  });
  ready = true;
}

export function track(event: EventName, props: Props = {}): void {
  if (ready) posthog.capture(event, props);
}
