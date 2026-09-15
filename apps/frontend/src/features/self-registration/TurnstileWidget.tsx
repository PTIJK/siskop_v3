import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
// Turnstile's published "always passes" test sitekey — fine for local dev,
// never for production. See .env.example / backend's TURNSTILE_SECRET_KEY.
const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || "1x00000000000000000000AA";

let scriptLoadPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoadPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Gagal memuat verifikasi captcha"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

export function TurnstileWidget({ onVerify, onExpire }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: onVerify,
          "expired-callback": onExpire
        });
      })
      .catch(() => {
        // Widget stays empty; the form's submit button stays disabled since
        // no token ever arrives — no separate error UI needed for this case.
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    };
  }, [onVerify, onExpire]);

  return <div ref={containerRef} />;
}
