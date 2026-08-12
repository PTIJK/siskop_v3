import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Production base path is a separate, still-open decision
  // (docs/07-System-Architecture-SISKOP-Mobile-Version.md §7 recommends
  // path-based serving at `/m/*` on the same tenant subdomain as desktop) —
  // not set here since it only matters for `vite build`, not `vite dev`.
  server: {
    port: 3002,
    // Same reasoning as apps/frontend/vite.config.ts: "localhost" is an
    // ambiguous string that can resolve to only the IPv6 loopback on some
    // machines. "0.0.0.0" binds every IPv4 interface.
    host: "0.0.0.0",
    // ".nip.io" (in addition to ".localhost") lets a real phone on the same
    // LAN reach this dev server via e.g. demo.<lan-ip>.nip.io:3002, while
    // still preserving subdomain-based tenant resolution — no phone-side
    // hosts-file edits needed. See docs/07 §7.
    allowedHosts: [".localhost", ".nip.io"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        // changeOrigin MUST stay false — see apps/frontend/vite.config.ts for
        // why (CLAUDE.md rule 1: tenant is resolved from the unrewritten Host
        // header, never from the request body).
        changeOrigin: false
      },
      "/uploads": {
        target: "http://localhost:3001",
        changeOrigin: false
      }
    }
  }
});
