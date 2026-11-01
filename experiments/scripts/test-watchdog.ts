// Names a test that runs past a deadline, then ends the run. bun buffers a file's results until the
// file ends, and its per-test timeout cannot interrupt synchronous code, so a spinning test would
// otherwise hang the suite with no output. The main thread records the test it starts; a worker
// thread, which the spin cannot block, watches it.
import { afterEach, beforeEach, setDefaultTimeout } from "bun:test"

// Stress laws execute 100,000 operations while compiler lanes build in parallel.
// bunfig.toml has no timeout setting: Bun ignores the key and stays at 5 s.
setDefaultTimeout(30_000)

const seconds = Number(process.env.KERNEL_TEST_STALL_SECONDS ?? "120")
const state = new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT))
const startedAt = new Float64Array(new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT))
const path = new Uint8Array(new SharedArrayBuffer(4096))
const STARTED = 0, FINISHED = 1, ORDINAL = 2, PATH_LENGTH = 3
let file = ""
let ordinal = 0

beforeEach(() => {
  if (Bun.main !== file) {
    file = Bun.main
    ordinal = 0
    const bytes = new TextEncoder().encode(file).subarray(0, path.length)
    path.set(bytes)
    Atomics.store(state, PATH_LENGTH, bytes.length)
  }
  Atomics.store(state, ORDINAL, ++ordinal)
  startedAt[0] = Date.now()
  Atomics.add(state, STARTED, 1)
})

afterEach(() => {
  Atomics.add(state, FINISHED, 1)
})

if (seconds > 0) {
  const worker = new Worker(new URL("./test-watchdog-worker.ts", import.meta.url))
  worker.postMessage({ state, startedAt, path, seconds })
  worker.unref()
}
