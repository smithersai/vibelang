import { Runtime } from "effect"

// Runs main as BrowserRuntime.runMain does, without its page hooks.
export const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => { process.exitCode = code }))
})
