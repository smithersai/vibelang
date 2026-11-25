import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { createServer } from "vite"

// Every test starts its Vite dev server here. Vite optimizes dependencies in
// the background, writing node_modules/.vite/deps_temp_*, and server.close()
// cancels a run without waiting for a write already under way, so a test that
// removes its fixture can race the optimizer and fail with ENOTEMPTY. No test
// loads an optimized dependency, so devServer turns the optimizer off; only
// scanServer, below, runs it.
export async function devServer(options, version = "vite") {
  const create = version === "vite" ? createServer : (await import(version)).createServer
  return create({ ...options, optimizeDeps: { noDiscovery: true, include: [] } })
}

// The dependency-scan tests need the optimizer. Their server writes its cache
// to a directory of its own outside the fixture, which close removes. Close
// first waits for the crawl to end and the optimizer run to finish. After each
// run Vite starts a 200 ms timer to log the dependencies it added, and close
// clears no such timer, so close then waits until the process holds no more
// timers than it did before the server started.
const timers = () => process.getActiveResourcesInfo().filter((name) => name === "Timeout").length

export async function scanServer(options) {
  const cacheDir = mkdtempSync(join(tmpdir(), "vibelang-vite-scan-"))
  const before = timers()
  const server = await createServer({ ...options, cacheDir })
  const close = server.close.bind(server)
  server.close = async () => {
    try {
      const environment = server.environments.client
      await environment.waitForRequestsIdle()
      const { metadata } = environment.depsOptimizer
      await Promise.all(Object.values({ ...metadata.discovered, ...metadata.optimized }).map((info) => info.processing))
      await close()
      const deadline = Date.now() + 10000
      while (timers() > before) {
        if (Date.now() > deadline) throw new Error(`the closed Vite server still holds ${timers() - before} timer(s)`)
        await delay(10)
      }
    } finally { rmSync(cacheDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  }
  return server
}
