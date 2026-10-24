import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/q3n8v/",
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
  },
});
