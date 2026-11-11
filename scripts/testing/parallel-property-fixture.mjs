// Small total predicates for the parallel-property harness contract tests.
import assert from "node:assert/strict"
export const pass = n => n * n >= 0
export const failure = n => n < 10
export const throws = n => { assert.ok(n < 10, "PRESERVED_ASSERTION_WITNESS") }
export const pair = (record, suffix) => record.value < 10 && suffix !== "bad"
export const reordered = n => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n % 4)
  return n < 10
}
export const exit = () => process.exit(0)
export const counted = (...inputs) => {
  const { appendFileSync } = process.getBuiltinModule("node:fs")
  const { threadId } = process.getBuiltinModule("node:worker_threads")
  appendFileSync(process.env.PARALLEL_PROPERTY_TRACE, JSON.stringify({ inputs, threadId }) + "\n")
}
export const triple = (members, flip, order) => members.length < 3 || flip === null || !order
export const asyncPass = async n => { await Promise.resolve(); return n * n >= 0 }
export const asyncFailure = async n => { await new Promise(resolve => setImmediate(resolve)); return n < 10 }
export const asyncThrows = async n => { await Promise.resolve(); assert.ok(n < 10, "ASYNC_ASSERTION_WITNESS") }
export const writers = [n => n, n => n + 3, n => n * 2]
export const coded = (write, n) => write(n) < 10
export const codedWorker = (index, n) => coded(writers[index], n)
export const largeFailure = () => {
  const error = new Error("ORACLE_FAILURE")
  error.actual = [...Array(250).fill("array witness"), "ARRAY_END_WITNESS"]
  error.witness = "x".repeat(20000) + "STRING_END_WITNESS"
  throw error
}
