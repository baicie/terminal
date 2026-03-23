import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  define: {
    IS_TAURI: JSON.stringify(true),
    IS_DEV: JSON.stringify(process.env.NODE_ENV === "development"),
    IS_MACOS: JSON.stringify(
      process.env.TAURI_ENV_PLATFORM?.includes("darwin") ?? false
    ),
    IS_WINDOWS: JSON.stringify(
      process.env.TAURI_ENV_PLATFORM?.includes("windows") ?? false
    ),
    IS_LINUX: JSON.stringify(
      process.env.TAURI_ENV_PLATFORM?.includes("linux") ?? false
    ),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        chunkFileNames: "js/[name].[hash].js",
        entryFileNames: "js/[name].[hash].js",
        manualChunks(id) {
          // 处理 pnpm 的依赖路径
          if (id.includes("node_modules")) {
            const directories = id.toString().split("node_modules/");
            if (directories.length > 2) {
              return directories[2].split("/")[0].toString();
            }
            return directories[1].split("/")[0].toString();
          }
        },
      },
    },
  },
}));
