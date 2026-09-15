import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  resolve: { alias: { "@": fileURLToPath(new URL("../engines/melee/web", import.meta.url)) }, dedupe: ["react", "react-dom", "three"] },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "app-assets",
  },
});
