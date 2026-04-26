import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // In dev Vite serves on 5173; Electron main opens http://localhost:5173.
  // In production Electron loads the built index.html as a file:// page.
  base: "./",
  server: { port: 5173 },
  build: { outDir: "dist" },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/testSetup.ts",
  },
});
