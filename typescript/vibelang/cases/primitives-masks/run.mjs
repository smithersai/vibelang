import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { main, callValue } from "./out/main.js"

// Keep tasks in priority/FIFO order, but delay the child's first dispatch.
// Interrupting after a sleep cannot prove the child has entered its mask.
let dispatchers = 0
const scheduler = {
  executionMode: "async",
  shouldYield: () => false,
  makeDispatcher() {
    const delay = ++dispatchers === 1 ? 100 : 0
    const tasks = []
    let timer
    const dispatcher = {
      scheduleTask(task, priority) {
        tasks.push({ task, priority })
        tasks.sort((a, b) => a.priority - b.priority)
        if (timer === undefined) timer = setTimeout(() => {
          timer = undefined
          dispatcher.flush()
        }, delay)
      },
      flush() {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        while (tasks.length) tasks.shift().task()
      }
    }
    return dispatcher
  }
}

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 10_000)
try {
  const result = await Effect.runPromise(main(), { scheduler, signal: controller.signal })
  console.log("@@result " + JSON.stringify(result))
} finally {
  clearTimeout(timeout)
}

// VIP-22: "Under VIP-6, the keywords remove the globals of the same name"
// Qualified native functions preserve their programs' success values.
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
fc.assert(fc.property(fc.integer(), (value) => {
  assert.deepEqual(
    Effect.runSyncExit(callValue(value)),
    Effect.runSyncExit(Effect.uninterruptible(Effect.succeed(value))),
  )
}), { seed: 2206, numRuns: 100 })
