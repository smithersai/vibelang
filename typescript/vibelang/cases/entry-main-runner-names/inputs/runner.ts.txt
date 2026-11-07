import { Runtime } from "effect"

// A runner made with Effect's Runtime.makeRunMain, as a platform makes one.
export const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, () => {}))
})
