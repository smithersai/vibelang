import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parseDiagnostics, styleProblems } from "../lib/diagnostics.mjs"

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-ek4833-kept-grouping.json", import.meta.url), "utf8"))
// The compiler's own lines, from the corpus, so a reworded note fails here.
const [kept, keptNote, , , fixable, fixableNote] = corpus.output.split("\n")
const keep = { head: kept.replace(/^main\.vibe\(\d+,\d+\): /, ""), note: keptNote }
const fix = { head: fixable.replace(/^main\.vibe\(\d+,\d+\): /, ""), note: fixableNote }
const others = [
  { head: keep.head, note: "  No quick fix: some other reason this repair is refused." },
  { head: "warning EK4834: try Effect.succeed(v) is TypeScript's spelling; write v.", note: "  No quick fix: the fixed program would report TS1109." },
  { head: "warning EK4835: Effect.catch is TypeScript's spelling.", note: "  Its quick fix writes a catch handler." },
  { head: "error EK4402: process.pid is platform code.", note: "  Use the experimental Process service." }
]

test("EK4833: warnings never enter the style gate, wherever it stands in the output", () =>
  fc.assert(fc.property(
    fc.array(fc.record({ kind: fc.integer({ min: 0, max: others.length + 1 }), file: fc.constantFrom("a", "b", "c"), line: fc.integer({ min: 1, max: 400 }) }), { maxLength: 24 }),
    fc.subarray(["a", "b", "c"]),
    (entries, scope) => {
      const shapes = [keep, fix, ...others]
      const text = entries.map(({ kind, file, line }) => `src/${file}.vibe(${line},3): ${shapes[kind].head}\n${shapes[kind].note}`).join("\n") + "\n"
      const files = scope.map((f) => `src/${f}.vibe`)
      const got = styleProblems(parseDiagnostics(text), files).map((d) => `${d.file}:${d.line}:${d.code}`)
      const want = entries
        .filter(({ kind, file }) => shapes[kind].head.startsWith("error ") && files.includes(`src/${file}.vibe`))
        .map(({ kind, file, line }) => `src/${file}.vibe:${line}:${/(EK\d{4})/.exec(shapes[kind].head)[1]}`)
      assert.deepEqual(got, want)
    }
  ), { numRuns: 400, seed: 4833 }))
