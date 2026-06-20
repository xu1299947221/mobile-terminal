import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5178,
    proxy: {
      "/api": "http://127.0.0.1:3020",
      "/ws": {
        target: "ws://127.0.0.1:3020",
        ws: true
      },
      "/ttyd": "http://127.0.0.1:3020"
    }
  },
  build: {
    outDir: "dist"
  }
});
