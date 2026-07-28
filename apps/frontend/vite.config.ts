import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 3000,
    // Tenants are addressed by subdomain (demo.localhost:3000), and *.localhost
    // resolves to loopback in browsers without a hosts-file entry — but it can
    // resolve to EITHER 127.0.0.1 or ::1 depending on the client. host: "localhost"
    // let Node resolve that ambiguous string itself, which on this machine bound
    // only the IPv6 loopback and left 127.0.0.1:3000 refusing every connection.
    // "0.0.0.0" binds every IPv4 interface, guaranteeing 127.0.0.1 is reachable,
    // and matches the backend's own default (unqualified `.listen(port)`, dual-stack).
    host: "0.0.0.0",
    allowedHosts: [".localhost"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        // changeOrigin MUST stay false. Setting it true rewrites the Host
        // header to the proxy target, which would erase the tenant subdomain
        // before the backend's slugFromHost() ever sees it and make every
        // login fail with "cooperative not identified". Production nginx must
        // likewise pass the original Host through (proxy_set_header Host $host).
        changeOrigin: false
      },
      // Serves member KTP uploads (apps/backend/src/app.ts) — no tenant
      // resolution involved, so changeOrigin doesn't matter here.
      "/uploads": {
        target: "http://localhost:3001",
        changeOrigin: false
      }
    }
  }
});
