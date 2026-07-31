import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite proxies the BFF (and Supabase Auth) so the browser talks to a single
// origin during dev — no CORS gymnastics required.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/functions": { target: "http://127.0.0.1:54321", changeOrigin: true },
      "/auth":      { target: "http://127.0.0.1:54321", changeOrigin: true },
      "/rest":      { target: "http://127.0.0.1:54321", changeOrigin: true },
    },
  },
});
