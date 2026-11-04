import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { addCompilerScripts, replaceTsc } from "../lib/wire.mjs"

test("opencode: setup replaces the forced built-in Bun checker without changing tests", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-codemode-js-test-import.json", import.meta.url)))
  const pkg = { scripts: { typecheck: corpus.script, check: "bun run lint" } }
  const next = addCompilerScripts(pkg, "file:compiler.tgz")
  assert.equal(next.scripts.typecheck, "vibelang --noEmit")
  assert.equal(next.scripts.check, pkg.scripts.check)
  assert.equal(next.devDependencies.vibelang, "file:compiler.tgz")
  assert.deepEqual(addCompilerScripts(next, "file:compiler.tgz"), next)
  assert.equal(pkg.scripts.typecheck, corpus.script)
})

test("forced Bun check preserves project arguments, order, and unrelated script commands", () => {
  assert.equal(replaceTsc({ typecheck: "echo prepare && bun check --no-script -p 'test project/tsconfig.json' && bun check --no-script -p tests.json && echo done" }).typecheck,
    "echo prepare && vibelang --noEmit -p 'test project/tsconfig.json' && vibelang --noEmit -p tests.json && echo done")
  for (const script of ["bun check", "bun run check --no-script", "bun check.ts --no-script", "echo bun check --no-script", "echo 'bun check --no-script'", "bun check --no-script --future-flag", "bun check --no-script -p $PROJECT", "bun check --no-script || true", '"bun" check --no-script', 'bun check "--no-script"', "bun check -p tests.json --no-script"]) {
    assert.equal(replaceTsc({ typecheck: script }).typecheck, script)
  }
})
