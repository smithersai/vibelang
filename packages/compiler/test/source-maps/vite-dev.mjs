// node vite-dev.mjs, run in a fixture: starts Vite's dev server, fetches the
// module as a browser does, and rewrites an SSR stack as Vite's own overlay does.
import { createServer } from "vite"
import { plugin } from "./helpers.mjs"

const vibelang = (await import(plugin("vite/src/index.js"))).default
const server = await createServer({
  root: process.cwd(), configFile: false, logLevel: "error", plugins: [vibelang()],
  server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { noDiscovery: true, include: [] },
  // The fixture links the runtime from outside any node_modules, which Vite would inline.
  ssr: { external: ["effect", "vibelang-runtime"] }
})
await server.listen()
try {
  const code = await (await fetch(new URL("/src/main.vibe", server.resolvedUrls.local[0]))).text()
  const { plainTrace } = await server.ssrLoadModule("/src/main.vibe")
  const error = plainTrace()
  server.ssrFixStacktrace(error)
  console.log(JSON.stringify({ code, stack: error.stack }))
} finally {
  await server.close()
}
