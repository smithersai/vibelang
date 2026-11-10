import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { casesIn } from "../../.smithers/flows/convert/cases.mjs"
import { command, defaultCompiler, linkModules } from "./check-snippets"

const cases = () => casesIn(new URL("../../.smithers/flows/convert/examples/", import.meta.url).pathname)
const config = (language: string) => JSON.stringify({
  compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [], skipLibCheck: true, outDir: "out" },
  files: ["main." + language]
})

async function withExample(source: string, language: "vibe" | "ts", run?: string) {
  const temp = mkdtempSync(join(tmpdir(), "convert-example-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), '{"type":"module"}')
    writeFileSync(join(temp, "main." + language), source)
    writeFileSync(join(temp, "tsconfig.json"), config(language))
    const compiler = language === "vibe" ? [defaultCompiler(), "--singleThreaded"] : ["node", createRequire(import.meta.url).resolve("typescript/lib/tsc.js")]
    const compiled = await command([...compiler, "--pretty", "false", "-p", "tsconfig.json"], temp, 30000)
    expect(compiled.stdout + compiled.stderr).toBe("")
    expect(compiled.exitCode).toBe(0)
    if (run === undefined) return
    writeFileSync(join(temp, "observe.mjs"), run)
    const result = await command(["node", "observe.mjs"], temp, 30000)
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
    return result.stdout
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("every worked conversion example compiles as a complete module", async () => {
  for (const example of cases()) {
    await withExample(example.expected, "vibe")
  }
}, 120000)

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
