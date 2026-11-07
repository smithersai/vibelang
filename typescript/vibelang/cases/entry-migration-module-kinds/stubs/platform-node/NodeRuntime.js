import { Runtime } from "effect"

// Runs main as NodeRuntime.runMain does, without its signal handling.
export const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => { process.exitCode = code }))
})
