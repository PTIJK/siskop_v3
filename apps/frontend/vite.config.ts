import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 3000,
    // Tenants are addressed by subdomain (demo.localhost:3000), and *.localhost
    // resolves to loopback in browsers without a hosts-file entry.
    host: "localhost",
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
      }
    }
  }
});
