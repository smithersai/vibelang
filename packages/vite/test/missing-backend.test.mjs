import { fileURLToPath } from "node:url"
import { missingBackendTests } from "../../compiler/test/bundler-missing-backend.mjs"

missingBackendTests({
  packageDir: fileURLToPath(new URL("..", import.meta.url)),
  dependencies: ["@jridgewell/remapping", "magic-string"],
  entry: async (module, options) => (await import(module)).default(options),
  message: "vibelang-vite needs the vibelang package: npm install --save-dev vibelang"
})
