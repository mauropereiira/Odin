import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SERVER_PORT = process.env.HELM_PORT || "7420";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
      "/ws": { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true },
    },
  },
});
