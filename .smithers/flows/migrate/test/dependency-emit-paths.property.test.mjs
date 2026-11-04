import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { emitErrorsIn } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-server-dependency-emit.json", import.meta.url)))

function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "dependency-emit-"))
  const module = (version, { name = corpus.package, subpath = corpus.module, peers = "" } = {}) => {
    const dir = join(root, "node_modules/.pnpm", name.replace("/", "+") + "@" + version + peers, "node_modules", name)
    mkdirSync(dirname(join(dir, subpath)), { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }))
    writeFileSync(join(dir, subpath + ".d.ts"), "export declare const NodeInspectSymbol: unique symbol;\n")
    return join(dir, subpath)
  }
  const diagnostics = path => corpus.diagnostics.map(d => ({
    ...d, category: "error", message: d.message.replace("$MODULE", path), notes: []
  }))
  try { return body({ root, module, diagnostics }) }
  finally { rmSync(root, { recursive: true, force: true }) }
}

test("t3code server: proven dependency-version paths retain inherited emit identity", () => fixture(({ root, module, diagnostics }) => {
  const before = diagnostics(module(corpus.beforeVersion))
  const current = diagnostics(module(corpus.afterVersion))
  const baseline = { code: 2, diagnostics: before }
  const pathSubstitutions = []
  assert.deepEqual(emitErrorsIn(current, [], { code: 2, baseline, cwd: root, pathSubstitutions }), [])
  assert.equal(pathSubstitutions.length, 3, "retain a receipt for each inherited path substitution")
  assert.deepEqual(current, diagnostics(module(corpus.afterVersion)), "keep raw diagnostics intact")
  assert.ok(emitErrorsIn(current, [], { code: 2 }).length, "the original receipt remains required")
}))

test("dependency paths never excuse changed symbols, owners, codes, notes or multiplicity", () => fixture(({ root, module, diagnostics }) => {
  const original = diagnostics(module(corpus.beforeVersion))
  const current = diagnostics(module(corpus.afterVersion))
  const baseline = { code: 2, diagnostics: original }
  const check = values => emitErrorsIn(values, [], { code: 2, baseline, cwd: root })
  for (const change of [
    d => ({ ...d, message: d.message.replace("NodeInspectSymbol", "OtherSymbol") }),
    d => ({ ...d, file: "apps/server/src/other.ts" }),
    d => ({ ...d, code: "TS2883" }),
    d => ({ ...d, notes: ["changed constraint"] }),
    d => ({ ...d, message: d.message.replace("cannot be named", "cannot be exported") })
  ]) assert.ok(check([change(current[0]), ...current.slice(1)]).length)
  assert.ok(check(current.slice(1)).length, "path tolerance requires the complete original diagnostic census")
  assert.ok(check([...current, current[0]]).length)
  assert.ok(check([{ ...current[0], message: current[0].message + " another error" }]).length)
}))

test("unproven files, package identities, peer contexts and unrelated paths still fail", () => fixture(({ root, module, diagnostics }) => {
  const oldPath = module(corpus.beforeVersion)
  const newPath = module(corpus.afterVersion)
  const baseline = { code: 2, diagnostics: diagnostics(oldPath) }
  const check = path => emitErrorsIn(diagnostics(path), [], { code: 2, baseline, cwd: root })
  for (const path of [
    module(corpus.afterVersion, { name: "other" }),
    module(corpus.afterVersion, { subpath: "dist/Other" }),
    module(corpus.afterVersion, { peers: "_peer@2.0.0" }),
    newPath.replace("node_modules/.pnpm", "other_modules/.pnpm"),
    newPath.replace(corpus.afterVersion, "4.1.999")
  ]) assert.ok(check(path).length, path)
  writeFileSync(join(dirname(dirname(newPath)), "package.json"), JSON.stringify({ name: "wrong", version: corpus.afterVersion }))
  assert.ok(check(newPath).length, "the installed manifest must prove the package identity")
  writeFileSync(join(dirname(dirname(newPath)), "package.json"), JSON.stringify({ name: corpus.package, version: corpus.afterVersion }))
  rmSync(newPath + ".d.ts")
  assert.ok(check(newPath).length, "an absent module cannot prove a substitution")
  symlinkSync(oldPath + ".d.ts", newPath + ".d.ts")
  assert.ok(check(newPath).length, "a module symlink outside the pinned package is not proof")
}))

// The migration contract compares source identity, code, message, notes and multiplicity.
// Only an installed package version may change inside a proved module reference.
test("generated dependency neighbourhoods preserve precisely the proved version segment", () => fixture(({ root, module, diagnostics }) => {
  fc.assert(fc.property(
    fc.constantFrom("effect", "@scope/library"),
    fc.integer({ min: 0, max: 30 }),
    fc.constantFrom("dist/Inspectable", "dist/internal/Types"),
    (name, patch, subpath) => {
      const a = module("4.1." + patch, { name, subpath })
      const b = module("4.2." + patch, { name, subpath })
      const baseline = { code: 2, diagnostics: diagnostics(a) }
      const current = diagnostics(b)
      assert.deepEqual(emitErrorsIn(current, [], { code: 2, baseline, cwd: root }), [])
      for (const count of [1, 2]) {
        assert.ok(emitErrorsIn(current.slice(count), [], { code: 2, baseline, cwd: root }).length, "a missing original error prevents path relaxation")
        assert.ok(emitErrorsIn([...current, ...current.slice(0, count)], [], { code: 2, baseline, cwd: root }).length, "additional errors prevent path relaxation")
      }
      const changed = current.map(d => ({ ...d, message: d.message.replace("NodeInspectSymbol", "NewSymbol") }))
      assert.ok(emitErrorsIn(changed, [], { code: 2, baseline, cwd: root }).length)
      const peer = module("4.2." + patch, { name, subpath, peers: "_peer@1.0.0" })
      assert.ok(emitErrorsIn(diagnostics(peer), [], { code: 2, baseline, cwd: root }).length)
    }
  ), { seed: 1344023, numRuns: 150 })
}))
