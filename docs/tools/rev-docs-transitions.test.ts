import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { command, defaultCompiler, linkModules } from "./check-snippets"

test("RD-003: migration rules retire the service-lookup and native-clock blockers", () => {
  const text = readFileSync(new URL("../../.smithers/flows/migrate/rules.md", import.meta.url), "utf8")
  expect(text).not.toContain("is EK0502")
  expect(text).not.toContain("EK4403 rejects them")
  expect(text).toContain("controllable tests")
  for (const file of ["rules.md", "context.md"]) {
    const guide = readFileSync(new URL("../../.smithers/flows/migrate/" + file, import.meta.url), "utf8")
    expect(guide.split("\n").filter(line => /never[^\n]*`(?:Date|Math)\./.test(line))).toEqual([])
    expect(guide).toContain("ordinary ECMAScript calls and remain legal")
  }
})

test("RD-003 property: injected service lookups and plain native time helpers compile", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[A-Z][a-z]{1,8}$/), fc.integer({ min: 0, max: 999 }), async (name: string, value: number) => {
    const temp = mkdtempSync(join(tmpdir(), "docs-transition-property-"))
    try {
      linkModules(temp)
      writeFileSync(join(temp, "package.json"), '{"type":"module","name":"docs-transition-property"}')
      writeFileSync(join(temp, "main.vibe"), [
        'service ' + name + ' { get(): number!! }',
        'export effect function lookup() { const service = try ' + name + '; return try service.get() }',
        'export function now(): number { return Date.now() }',
        'export function random(): number { return Math.random() }',
        'export function date(): Date { return new Date(' + value + ') }',
        'export function dateString(): string { return Date() }',
        'export { ' + name + ' }'
      ].join("\n"))
      writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [], skipLibCheck: true, outDir: "out" }, files: ["main.vibe"]
      }))
      expect(await command([defaultCompiler(), "--singleThreaded", "-p", "tsconfig.json"], temp, 30000)).toMatchObject({ exitCode: 0 })
      writeFileSync(join(temp, "oracle.mjs"), 'import assert from "node:assert/strict"; import { Effect } from "effect"; import { lookup, now, random, date, dateString, ' + name + ' } from "./out/main.js"; assert.equal(await Effect.runPromise(Effect.provideService(lookup(), ' + name + ', { get: () => Effect.succeed(' + value + ') })), ' + value + '); assert.ok(Number.isFinite(now())); const r = random(); assert.ok(r >= 0 && r < 1); assert.equal(date().getTime(), ' + value + '); assert.equal(typeof dateString(), "string")')
      expect((await command(["node", "oracle.mjs"], temp, 30000)).exitCode).toBe(0)
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }), { numRuns: 8, seed: 4003 })
}, 60000)

// "Where this toolchain is behind the skill" defers a skill form only until the
// compiler takes it: "The lane that lands the change deletes its row."
function behindRows(text: string) {
  const start = text.indexOf("## Where this toolchain is behind the skill")
  if (start < 0) throw new Error("the migration rules keep their toolchain table")
  const end = text.indexOf("\n## ", start + 1)
  return text.slice(start, end < 0 ? undefined : end).split("\n")
    .filter(line => line.startsWith("| ") && !line.startsWith("| The skill") && !line.startsWith("| ---"))
    .map(line => {
      const [skill, write, until] = line.split("|").slice(1, 4).map(cell => cell.trim())
      return { skill, write, until, codes: until.match(/\b(?:TS|EK)\d{4,5}\b/g) ?? [] }
    })
}

// A row that names a diagnostic needs a witness here, keyed by its first cell:
// source that still reports each code. When the witness compiles, the row's
// change has landed and the row goes.
const behindWitnesses: Record<string, string> = {}

async function compileWitness(source: string) {
  const temp = mkdtempSync(join(tmpdir(), "docs-transition-witness-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), '{"type":"module","name":"docs-transition-witness"}')
    writeFileSync(join(temp, "main.vibe"), source)
    writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [], skipLibCheck: true, outDir: "out" }, files: ["main.vibe"]
    }))
    const compiled = await command([defaultCompiler(), "--singleThreaded", "--pretty", "false", "-p", "tsconfig.json"], temp, 30000)
    const ran = compiled.exitCode === 0 ? await command(["node", "out/main.js"], temp, 30000) : undefined
    return { compiled, ran }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

const formerBehindRows = [
  "| Every export of `Effect` as a global: `ensuring(…)`, `scoped(…)`, `onExit(…)`, `serviceOption(…)`, `currentParentSpan` | `Effect.ensuring(…)`, `Effect.scoped(…)`, `Effect.onExit(…)`, `Effect.serviceOption(…)`, `Effect.currentParentSpan`; unqualified are `all`, `die` and `withSpan` | TS2304 |",
  "| `fork.scoped w()`, `fork.in(scope) w()`, `fork.detached w()` | `Effect.forkScoped(w())`, `Effect.forkIn(w(), scope)`, `Effect.forkDetach(w())` | TS1005, EK4410 |"
]

test("RD-072: a deferred form in the migration rules names a diagnostic only while a witness still reports it", async () => {
  expect(behindRows("## Where this toolchain is behind the skill\n\n| The skill | Write on this toolchain | Until then |\n| --- | --- | --- |\n" + formerBehindRows.join("\n") + "\n\n## Next\n").map(row => row.codes))
    .toEqual([["TS2304"], ["TS1005", "EK4410"]])
  for (const file of ["rules.md", "context.md"]) {
    const rows = behindRows(readFileSync(new URL("../../.smithers/flows/migrate/" + file, import.meta.url), "utf8"))
    expect(rows.length, file + " keeps the compiler-model row").toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.skill, file).not.toMatch(/fork\.(?:scoped|in\(|detached)|Every export of `Effect` as a global/)
      if (!row.codes.length) continue
      const witness = behindWitnesses[row.skill]
      if (witness === undefined) throw new Error(file + ": the row \"" + row.skill + "\" names " + row.codes.join(", ") + " and has no witness that still reports it")
      const { compiled } = await compileWitness(witness)
      for (const code of row.codes) expect(compiled.stdout + compiled.stderr, file + ": " + row.skill).toContain(code)
    }
  }
}, 60000)

test("RD-072 property: the forms those rows deferred compile and run", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  const forms = [
    'out.push(try ensuring(w(), sync(() => { out.push(-1) })))',
    'out.push(try onExit(w(), () => sync(() => { out.push(-2) })))',
    'out.push(Option.isNone(try serviceOption(Users)) ? 1 : 0)',
    'out.push((try exit(currentParentSpan))._tag === "Failure" ? 1 : 0)',
    'out.push(try scoped(effect { return join (fork.scoped w()) }))',
    'out.push(try scoped(effect { const scope = try Scope.make(); return join (fork.in(scope) w()) }))',
    'out.push(join (fork.detached w()))'
  ]
  await fc.assert(fc.asyncProperty(fc.subarray(forms, { minLength: 1 }), async (chosen: string[]) => {
    const { compiled, ran } = await compileWitness([
      'service Users { find(id: string): string!! }',
      'effect function w(): number!! { try sleep("1 millis"); return 4 }',
      'effect function main() {',
      '  const out: number[] = []',
      ...chosen.map(form => '  ' + form),
      '  try Console.log(out.length)',
      '}',
      'await runPromise(main())'
    ].join("\n"))
    expect(compiled.stdout + compiled.stderr).toBe("")
    expect(compiled.exitCode).toBe(0)
    expect(ran?.exitCode).toBe(0)
    expect(Number(ran?.stdout.trim())).toBeGreaterThanOrEqual(chosen.length)
  }), { numRuns: 8, seed: 4072, examples: [[forms]] })
}, 120000)
