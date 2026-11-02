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
export function devServer(options) {
  return createServer({ ...options, optimizeDeps: { noDiscovery: true, include: [] } })
}

// The dependency-scan tests need the optimizer. Their server writes its cache
// to a directory of its own outside the fixture, which close removes. Close
// first waits for the crawl to end and the optimizer run to finish, then for
// the 200 ms timer after which Vite logs the dependencies that run added: close
// clears none of these timers.
export async function scanServer(options) {
  const cacheDir = mkdtempSync(join(tmpdir(), "vibelang-vite-scan-"))
  const server = await createServer({ ...options, cacheDir })
  const close = server.close.bind(server)
  server.close = async () => {
    try {
      const environment = server.environments.client
      await environment.waitForRequestsIdle()
      const { metadata } = environment.depsOptimizer
      await Promise.all(Object.values({ ...metadata.discovered, ...metadata.optimized }).map((info) => info.processing))
      await delay(250)
      await close()
    } finally { rmSync(cacheDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  }
  return server
}
