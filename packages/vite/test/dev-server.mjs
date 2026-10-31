import { createServer } from "vite"

// Every test starts its Vite dev server here. Vite optimizes dependencies in
// the background, writing node_modules/.vite/deps_temp_*, and server.close()
// cancels a run without waiting for a write already under way, so a test that
// removes its fixture can race the optimizer and fail with ENOTEMPTY. No test
// loads an optimized dependency, so no test server runs the optimizer.
export function devServer(options) {
  return createServer({ ...options, optimizeDeps: { noDiscovery: true, include: [] } })
}
