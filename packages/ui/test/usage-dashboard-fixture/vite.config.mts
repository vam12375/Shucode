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
  resolve: {
    alias: {
      "@": resolve(root, "packages/ui/src"),
      "@shucode/shared": resolve(root, "packages/shared/src/index.ts"),
      "@shucode/services": resolve(root, "packages/services/src/index.ts"),
      "d3-path": resolve(root, "node_modules/d3-path/src/index.js"),
    },
  },
  server: { port: 5188, strictPort: true, host: "127.0.0.1", hmr: false, fs: { allow: [root] } },
  optimizeDeps: { include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"] },
  define: {
    __SHUCODE_ENDPOINT_ENV__: JSON.stringify("production"),
    __SHUCODE_VERSION__: JSON.stringify("fixture"),
    __SHUCODE_COMMIT__: JSON.stringify("fixture"),
    __SHUCODE_ENV__: JSON.stringify("test"),
  },
});
