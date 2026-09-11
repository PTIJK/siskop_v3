/** Public-host routing belongs to onboarding; tenant authentication stays in the existing app. */
export function workspaceSlug(): string | null {
  const host = window.location.hostname;
  const publicHost = import.meta.env.VITE_PUBLIC_APP_HOST;
  if (host === publicHost || host === `www.${publicHost}` || host === "localhost" || host === "127.0.0.1")
    return null;
  const [first, ...rest] = host.split(".");
  if (first === "www" || (rest.length === 1 && rest[0] !== "localhost")) return null;
  return rest.length > 0 && first ? first : null;
}
