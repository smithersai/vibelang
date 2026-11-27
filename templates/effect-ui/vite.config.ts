import vibelang from "vibelang-vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [vibelang()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{vibe,vibex,ts}"]
  }
})
