import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import UnoCSS from "unocss/vite";
import presetUno from "@unocss/preset-uno";
import autoprefixer from "autoprefixer";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    UnoCSS({ presets: [presetUno()] }),
    react({
      tsDecorators: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  css: {
    postcss: {
      plugins: [
        autoprefixer({
          overrideBrowserslist: ["last 2 versions", ">1%", "ie >= 11"],
        }),
      ],
    },
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
      // 3. tell vite to ignore watching `src-tauri`
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
