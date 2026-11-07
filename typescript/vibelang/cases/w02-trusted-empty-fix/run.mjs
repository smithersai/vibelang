// rule-evidence: docs/design/src/007-tooling.md#empty-legacy-trust-wrappers | For each private direct synchronous call in an explicit Effect body, `vibelang --fix` writes an identity-mapped `Effect.try` and `Effect.orDie` bridge over `f`, captured at the original declaration, or refuses if preservation cannot be proved.
// The fix captures f once where trusted(f, []) captured it, calls it with no
// receiver, and runs each direct call in an Effect body through
// Effect.try with the identity catch and Effect.orDie, so the exact thrown
// value becomes a defect. An exported or escaping wrapper is left as written.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
// run-seconds: 240
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const here = (name) => new URL("./" + name, import.meta.url)
function project(prefix, files, names) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  symlinkSync(fileURLToPath(here("node_modules")), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  for (const [to, from] of Object.entries(files)) writeFileSync(join(root, to), readFileSync(here(from)))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, rewriteRelativeImportExtensions: true, declaration: true, outDir: "out" },
    files: names ?? Object.keys(files)
  }))
  return root
}
function tsc(root, args) {
  return spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded", ...args], { cwd: root, encoding: "utf8", timeout: 60000 })
}
const load = (root, dir, file) => import(pathToFileURL(join(root, dir, file)).href)
const root = project("w02-trusted-empty-fix-", { "lib.vibe": "input.txt", "plain.ts": "plain.txt" })
const kept = project("w02-trusted-empty-refused-", { "main.vibe": "refused.txt" })
try {
  const fixed = tsc(root, ["--fix"])
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
  assert.match(fixed.stdout, /trusted empty-list migration ×1/)
  const text = readFileSync(join(root, "lib.vibe"), "utf8")
  assert.ok(!text.includes("trusted(Dialect.parse, [])"), text)
  // Captured at the original declaration: the implementation is read there.
  assert.match(text, /\nconst parse_impl = \(void trusted, Dialect\.parse\), parse: typeof parse_impl = function \(\.\.\.args\) \{ return parse_impl\.apply\(void 0, args\) \}\n/)
  // The call stays in place inside the identity-mapped bridge.
  assert.match(text, /return \(try Effect\.orDie\(Effect\.try\(\{ try: \(\) => parse\(text\), catch: \(e\) => e \}\)\)\) \+ 1/)
  const lib = await load(root, "out", "lib.js")
  const plain = await load(root, "out", "plain.js")
  assert.equal(plain.reads(), 1, "f is read once, when the declaration runs")
  assert.equal(await Effect.runPromise(lib.parsed("41")), 42)
  const exit = await Effect.runPromiseExit(lib.parsed("x"))
  assert.ok(Exit.isFailure(exit))
  assert.equal(Cause.hasFails(exit.cause), false, "a throw is a defect, not a typed failure")
  assert.equal(Cause.squash(exit.cause), plain.lastThrown(), "the defect is the exact thrown value")
  assert.equal(plain.reads(), 1, "calls do not re-read f")
  const again = tsc(root, ["--fix"])
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(readFileSync(join(root, "lib.vibe"), "utf8"), text, "the repair is a fixed point")
  // Refusal: an exported or escaping wrapper cannot be proved to preserve
  // the public API, so --fix leaves both declarations as written.
  const original = readFileSync(join(kept, "main.vibe"), "utf8")
  const refused = tsc(kept, ["--fix"])
  assert.doesNotMatch(refused.stdout, /trusted empty-list migration/)
  assert.equal(readFileSync(join(kept, "main.vibe"), "utf8"), original)
  console.log("trusted(f, []) becomes an identity-mapped Effect.try and Effect.orDie bridge")
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(kept, { recursive: true, force: true })
}
