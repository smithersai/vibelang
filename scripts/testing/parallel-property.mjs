// Evaluate independent, total predicates on bounded workers, then
// replay their results through fast-check. Sampling and failure shrinking keep
// the original seed and run count; shrink candidates run through the same oracle.
import { propertySlice } from "./property-slice.mjs"
import { Worker, workerData, parentPort } from "node:worker_threads"
import { inspect, isDeepStrictEqual } from "node:util"

if (workerData?.propertyOracle) {
  const oracle = (await import(workerData.propertyOracle))[workerData.exportName ?? "check"]
  parentPort.on("message", async ({ id, input }) => {
    try {
      const returned = oracle(...input)
      if (!workerData.asyncPredicate && returned?.then) throw new TypeError("synchronous property returned a Promise")
      parentPort.postMessage({ id, returned: await returned })
    }
    catch (error) {
      parentPort.postMessage({ id, failed: true, message: error.message, detail: inspect(error, { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, customInspect: false }) })
    }
  })
}

export async function prepareParallelProperty(fc, { arbitraries, oracle, module, exportName = "check", seed, numRuns, concurrency = 4, asyncPredicate = false, encode = inputs => inputs, env = process.env }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("property concurrency must be positive")
  const options = { seed, numRuns }
  const samples = []
  const factory = asyncPredicate ? fc.asyncProperty : fc.property
  const collect = (...input) => { samples.push(input) }
  await fc.assert(factory(...arbitraries, asyncPredicate ? async (...input) => collect(...input) : collect), options)
  const slice = propertySlice(env)
  const selected = samples.map((_, index) => index).filter(index => index % slice.count === slice.index)
  const outcomes = samples.map(() => ({ returned: true }))
  const workers = []
  let next = 0, completed = 0
  try {
    await new Promise((resolve, reject) => {
      const assign = worker => {
        if (next < selected.length) {
          try { const id = selected[next++]; worker.postMessage({ id, input: encode(samples[id]) }) }
          catch (error) { reject(error) }
        }
      }
      for (let i = 0; i < Math.min(concurrency, selected.length); i++) {
        const worker = new Worker(new URL(import.meta.url), {
          execArgv: [], workerData: { propertyOracle: module.href, exportName, asyncPredicate }
        })
        workers.push(worker)
        worker.on("error", reject)
        worker.on("exit", code => { if (completed !== selected.length) reject(new Error("property worker exited " + code)) })
        worker.on("message", result => {
          outcomes[result.id] = result
          if (++completed === selected.length) resolve()
          else assign(worker)
        })
        assign(worker)
      }
      if (!selected.length) resolve()
    })
  } finally { await Promise.all(workers.map(worker => worker.terminate())) }
  const property = () => {
    let at = 0, cached = true
    const replay = (...input) => {
      if (!cached) return oracle(...input)
      if (!isDeepStrictEqual(input, samples[at])) throw new Error("property replay diverged from its sampled input")
      const result = outcomes[at++]
      if (result.failed) {
        cached = false
        throw new Error(result.message + "\n" + result.detail)
      }
      if (result.returned === false) cached = false
      return result.returned
    }
    return factory(...arbitraries, asyncPredicate ? async (...input) => replay(...input) : replay)
  }
  return { samples, assert: () => fc.assert(property(), options), check: () => fc.check(property(), options) }
}

export async function assertParallelProperty(fc, options) {
  const prepared = await prepareParallelProperty(fc, options)
  return prepared.assert()
}
