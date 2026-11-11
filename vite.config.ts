import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// GitHub Pages serves the site from /<repo-name>/; BASE_PATH is set by the deploy workflow.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  test: { environment: "node" },
});
