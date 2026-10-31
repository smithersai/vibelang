import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parseStyleTree, preservedGlobalErrors } from "../lib/preserved-errors.mjs"
import { styleProblems } from "../lib/diagnostics.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-explicit-error-producers.json", import.meta.url)))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const native = { skip: !existsSync(compiler) && "build the native compiler" }
async function decide(before, after, marker) {
  const offset = after.indexOf(marker)
  assert.ok(offset >= 0, marker)
  const lines = after.slice(0, offset).split("\n")
  const d = { file: "main.vibe", line: lines.length, column: lines.at(-1).length + 1, code: "EK4804", category: "warning", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by." }
  const old = await parseStyleTree(compiler, "main.ts", before)
  const current = await parseStyleTree(compiler, "main.vibe", after)
  const result = preservedGlobalErrors(old, current, after, [d])
  return { ...result, diagnostic: d }
}
for (const c of corpus.cases) test("foldkit-29 explicit producer: " + c.name, native, async () => {
  const result = await decide(c.before, c.after, c.at)
  assert.equal(result.accepted.size, 1, JSON.stringify(result.decisions))
  assert.deepEqual(styleProblems([result.diagnostic], ["main.vibe"], result.accepted), [])
})

test("written Error producers retain only matching original call contracts", native, async () => {
  // Accepted 18:45Z ruling: "when the written failure type is the global Error that the original declared".
  await fc.assert(fc.asyncProperty(fc.constantFrom(...corpus.cases), fc.constantFrom("Error", "TypeError", "never"), fc.constantFrom("Error", "TypeError", "never"), fc.constantFrom("load", "request", "register"), fc.boolean(), async (c, oldChannel, newChannel, name, shadowed) => {
    const before = c.before.replaceAll("load", name).replaceAll("Error", oldChannel)
    let after = c.after.replaceAll("load", name).replaceAll("Error", newChannel)
    let marker = c.at.replaceAll("Error", newChannel)
    if (shadowed) after = "class Error {}\n" + after
    const result = await decide(before, after, marker)
    assert.equal(result.accepted.size, !shadowed && oldChannel === "Error" && newChannel === "Error" ? 1 : 0, JSON.stringify({ c: c.name, oldChannel, newChannel, shadowed, decisions: result.decisions }))
  }), { seed: 290031, numRuns: 120 })
})

test("producer evidence cannot cross unrelated, shadowed or changed callback boundaries", native, async () => {
  const named = corpus.cases[1], callback = corpus.cases[2], curried = corpus.cases[0]
  for (const [before, after, marker] of [
    [named.before.replace("catch: toError", "catch: other"), named.after, named.at],
    [named.before.replace("const toError", "let toError"), named.after, named.at],
    [named.before + "\nfunction another(toError: unknown): void {}", named.after, named.at],
    [named.before, named.after.replace("load =", "different ="), named.at],
    [callback.before.replace("Effect.callback", "Other.callback"), callback.after, callback.at],
    [named.before, "const Effect = foreign;\n" + named.after, named.at],
    [named.before + "\nconst unrelated = () => Effect.try({ try: () => 1, catch: toError })", named.after.replace("catch: toError", "catch: other"), "other })"],
    [named.before, named.after.replace("return try", "try Effect.try({ try: (): number => 0, catch: toError }); return try"), named.at],
    [callback.before.replace("<number, Error>", "<number, TypeError>"), callback.after, callback.at],
    [curried.before, curried.after.replace("return (effect { throw new Error(prefix) }) catch effect (error) =>", "const nested = effect () =>"), curried.at],
    [named.before, named.after.replace("catch: toError", "catch: (cause) => toError(cause)"), "toError(cause)"]
  ]) assert.equal((await decide(before, after, marker)).accepted.size, 0, after)
})

test("foldkit producer corpus compiles and exempts the real compiler's advisory locations", native, async () => {
  const { spawnSync } = await import("node:child_process")
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join, dirname } = await import("node:path")
  const { parseDiagnostics } = await import("../lib/diagnostics.mjs")
  const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
  for (const c of corpus.cases) {
    const root = mkdtempSync(join(tmpdir(), "migrate-error-producers-"))
    try {
      mkdirSync(join(root, "node_modules"))
      symlinkSync(dirname(require.resolve("effect/package.json")), join(root, "node_modules/effect"))
      symlinkSync(fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)), join(root, "node_modules/vibelang-runtime"))
      writeFileSync(join(root, "package.json"), '{"type":"module"}')
      writeFileSync(join(root, "main.ts"), c.before)
      writeFileSync(join(root, "main.vibe"), c.after)
      let ds
      for (const file of ["main.ts", "main.vibe"]) {
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", target: "ES2022", strict: true, noEmit: true, skipLibCheck: true }, files: [file] }))
        const r = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30_000 })
        assert.equal(r.status, 0, c.name + ": " + r.stdout + r.stderr)
        if (file.endsWith(".vibe")) ds = parseDiagnostics(r.stdout + r.stderr)
      }
      const warnings = ds.filter(d => d.code === "EK4804")
      assert.ok(warnings.length > 0, c.name + ": the compiler must produce the advisory")
      const result = preservedGlobalErrors(await parseStyleTree(compiler, "main.ts", c.before), await parseStyleTree(compiler, "main.vibe", c.after), c.after, warnings)
      assert.equal(result.accepted.size, warnings.length, c.name + ": " + JSON.stringify(result.decisions))
      assert.deepEqual(styleProblems(ds, ["main.vibe"], result.accepted), [])
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
