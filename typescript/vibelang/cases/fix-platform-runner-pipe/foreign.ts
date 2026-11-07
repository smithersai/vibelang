import * as Effect from "effect/Effect"
const events: string[] = []
export const program = Effect.sync(() => { events.push("program"); return 1 })
export const record = (label: string) => {
  events.push("build " + label)
  /** @throws {never} */
  function callback(value: number) { events.push("run " + label); return value + 1 }
  return callback
}
export const options = () => {
  events.push("build runner")
  return { teardown: () => { console.log(JSON.stringify(events)) } }
}
