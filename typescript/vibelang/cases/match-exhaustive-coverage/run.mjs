// Runs every arm of out/arms.js's matches under V8 block coverage, the
// counts c8 and Vitest's v8 provider report, and prints each range that no
// call reached. Only text's $noMatch, over a type that is not a finite
// union, may be missed (arms.vibe).
import fs from "node:fs"
import { Session } from "node:inspector/promises"
import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

const session = new Session()
session.connect()
await session.post("Profiler.enable")
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true })
const arms = await import("./out/arms.js")
const results = [
  ...["draft", "published"].map((p) => arms.phase(p)),
  arms.failure(new arms.NotFound({ id: "7" })),
  arms.failure(new arms.Denied({ user: "Ada" })),
  arms.parity(new arms.Even({ n: 2 })),
  arms.parity(new arms.Odd({ n: 3 })),
  arms.count(Option.none()),
  arms.count(Option.some(4)),
  arms.text("hi")
].map((program) => Effect.runSync(program))
const { result } = await session.post("Profiler.takePreciseCoverage")
await session.post("Profiler.stopPreciseCoverage")
console.log(JSON.stringify(results))
const script = result.find((s) => s.url.endsWith("/out/arms.js"))
const source = fs.readFileSync(fileURLToPath(script.url), "utf8")
for (const fn of script.functions) {
  for (const range of fn.ranges) {
    if (range.count === 0) console.log(`missed: ${source.slice(range.startOffset, range.endOffset).replace(/\s+/g, " ").trim()}`)
  }
}
