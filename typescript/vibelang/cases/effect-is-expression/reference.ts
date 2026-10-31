import { Effect } from "effect"
const effect: unknown = 7
const async: unknown = "ready"
typeof effect === "number"
typeof async === "string"
function plain(): boolean {
  typeof effect === "number"
  typeof async === "string"
  return typeof effect === "number" && typeof async === "string"
}
function deferred() {
  return Effect.gen(function*() {
    typeof effect === "number"
    typeof async === "string"
    return typeof effect === "number" && typeof async === "string"
  })
}
export function main() {
  return Effect.gen(function*() { return [plain(), yield* deferred()] })
}
