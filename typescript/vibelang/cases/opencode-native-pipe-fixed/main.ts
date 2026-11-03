// expect-result: "function"
import { Effect } from "effect"
import { handler } from "./lib.js"

export function main() {
  return Effect.succeed(typeof handler)
}
