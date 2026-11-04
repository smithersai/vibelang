import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { addCompilerScripts, replaceTsc } from "../lib/wire.mjs"

test("opencode GUI forced Bun build check selects the same compiler build mode", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-gui-bun-build-check.json", import.meta.url)))
  const pkg = { scripts: { typecheck: corpus.script, check: "bun run lint" } }
  const next = addCompilerScripts(pkg, "file:compiler.tgz")
  assert.equal(next.scripts.typecheck, "vibelang -b")
  assert.equal(next.scripts.check, pkg.scripts.check)
  assert.deepEqual(addCompilerScripts(next, "file:compiler.tgz"), next)
  assert.equal(pkg.scripts.typecheck, corpus.script)
})

test("forced Bun build preserves literal projects and authored emission options", () => {
  for (const flag of ["-b", "--build"]) {
    const command = "bun check --no-script " + flag + " 'app project/tsconfig.json' lib"
    assert.equal(replaceTsc({ typecheck: "echo before && " + command + " && echo after" }).typecheck,
      "echo before && vibelang " + flag + " 'app project/tsconfig.json' lib && echo after")
    assert.equal(replaceTsc({ typecheck: command + " --noEmit" }).typecheck,
      "vibelang " + flag + " 'app project/tsconfig.json' lib --noEmit")
  }
  for (const script of ["bun check -b", "bun run check --no-script -b", "bun check --no-script -b $PROJECT", "bun check --no-script -b --future-build-flag", "bun check --no-script --watch", "bun check --no-script --build &&", "echo 'bun check --no-script -b'"]) {
    assert.equal(replaceTsc({ typecheck: script }).typecheck, script)
  }
})
