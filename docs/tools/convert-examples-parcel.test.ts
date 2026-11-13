import { test } from "bun:test"
import { expect, join, createRequire, cases, withExample } from "./convert-examples-fixture"


// docs/design/src/002-running.md: "e catch h where e is not an Effect" is EK0506. A template
// substitution runs before a catch on the string; put the fallible interpolation
// inside the Effect operand to preserve the TypeScript map/catchTag boundary.
test("parcel recovery keeps its TypeScript behavior across generated identifiers and strings", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  const example = cases().find((item: { name: string }) => item.name === "01-parcel-errors")!
  const identifiers = fc.stringMatching(/^[A-Z][a-z]{2,10}Error$/)
  await fc.assert(fc.asyncProperty(identifiers, fc.string(), fc.string(), async (name: string, tracking: string, city: string) => {
    const mutate = (source: string) => source.replace(/\bMissingParcel\b/g, name)
      .replaceAll('"PK-9"', JSON.stringify(tracking)).replaceAll('"Oslo"', JSON.stringify(city))
    const missing = tracking + "!"
    const runner = [
      'import { Effect } from "effect";',
      'import { route, destinationOrDepot } from "./out/main.js";',
      'const ids = ' + JSON.stringify([tracking, missing]) + ';',
      'const effects = ids.flatMap(id => [route(id), destinationOrDepot(id)]);',
      'if (!effects.every(Effect.isEffect)) throw new Error("conversion must retain Effect-valued calls");',
      'console.log(JSON.stringify(await Promise.all(effects.map(effect => Effect.runPromise(effect)))));'
    ].join("\n")
    const expected = JSON.stringify(["Ship to " + city, city, "Investigate " + missing, "depot"]) + "\n"
    expect(await withExample(mutate(example.input), "ts", runner)).toBe(expected)
    expect(await withExample(mutate(example.expected), "vibe", runner)).toBe(expected)
  }), { numRuns: 8, seed: 4074, examples: [["MissingParcel", "PK-9", "Oslo"]] })
}, 180000)
