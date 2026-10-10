import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
export default defineConfig({
  root: directory,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(root, "packages/ui/src") } },
  server: { port: 5191, strictPort: true, host: "127.0.0.1", hmr: false, fs: { allow: [root] } },
  optimizeDeps: { include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"] },
});
