// node vite-dev.mjs, run in a fixture: starts Vite's dev server, fetches the
// module as a browser does, and rewrites an SSR stack as Vite's own overlay does.
import { createServer } from "vite"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { plugin } from "./helpers.mjs"

const vibelang = (await import(plugin("vite/src/index.js"))).default
const cacheProbe = join(process.env.VIBELANG_CACHE_DIR, "00000000000000000000000000000000.json")
let observed
const cacheUpdate = new Promise(resolve => { observed = resolve })
const server = await createServer({
  root: process.cwd(), configFile: false, logLevel: "error", plugins: [vibelang(), {
    name: "source-map-cache-observer",
    hotUpdate: { order: "post", handler(context) {
      if (context.file === cacheProbe && this.environment.name === "ssr") observed()
    } }
  }],
  server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { noDiscovery: true, include: [] },
  // The fixture links the runtime from outside any node_modules, which Vite would inline.
  ssr: { external: ["effect", "vibelang-runtime"] }
})
const watchEvents = []
server.watcher.on("all", (event, file) => {
  if (watchEvents.length < 40) watchEvents.push({ event, file })
})
await server.listen()
try {
  const code = await (await fetch(new URL("/src/main.vibe", server.resolvedUrls.local[0]))).text()
  const { plainTrace } = await server.ssrLoadModule("/src/main.vibe")
  // Compiler cache metadata is not a source input. Replay its watcher event
  // after loading so an invalidation race cannot hide behind fast imports.
  await writeFile(cacheProbe, "{}")
  let timer
  try {
    await Promise.race([cacheUpdate, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("cache watcher event was not observed")), 10000)
    })])
  } finally { clearTimeout(timer) }
  const error = plainTrace()
  const rawStack = error.stack
  const transformed = server.environments.ssr.moduleGraph.getModuleById(
    process.cwd() + "/src/main.vibe"
  )?.transformResult
  server.ssrFixStacktrace(error)
  console.log(JSON.stringify({
    code, stack: error.stack,
    diagnostics: {
      rawStack, watchEvents,
      invalidatedAt: server.environments.ssr.moduleGraph.getModuleById(process.cwd() + "/src/main.vibe")?.lastInvalidationTimestamp,
      ssrCode: transformed?.code,
      ssrMap: transformed?.map
    }
  }))
} finally {
  await server.close()
}
