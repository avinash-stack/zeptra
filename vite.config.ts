import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: "/",
  server: {
    host: "localhost",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@tanstack")) return "query";
          if (id.includes("lucide-react")) return "icons";
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            /\/node_modules\/react\//.test(id)
          ) {
            return "react-vendor";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
