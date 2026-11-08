import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { addCompilerScripts, replaceTsc } from "../lib/wire.mjs"

test("forced Bun build checks select VibeLang when --no-script follows the build flag or project", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-gui-bun-build-flag-order.json", import.meta.url), "utf8"))
  for (const [command, expected] of [
    [corpus.script, "vibelang -b"],
    ["bun check -b --no-script 'app project'", "vibelang -b 'app project'"],
    ["bun check -b 'app project' --no-script", "vibelang -b 'app project'"],
    ["bun check --build --no-script -p 'app project/tsconfig.json'", "vibelang --build 'app project/tsconfig.json'"],
    ["bun check -p 'app project/tsconfig.json' --no-script --build --noEmit", "vibelang --build 'app project/tsconfig.json' --noEmit"],
    ["bun check -p tests.json --no-script", "vibelang --noEmit -p tests.json"],
    ["bun check -p 'project --no-script name.json' --no-script", "vibelang --noEmit -p 'project --no-script name.json'"]
  ]) {
    assert.equal(replaceTsc({ typecheck: "echo before && " + command + " && echo after" }).typecheck,
      "echo before && " + expected + " && echo after")
    const pkg = { scripts: { typecheck: command, check: "bun run lint" } }
    const next = addCompilerScripts(pkg, "unused")
    assert.equal(next.scripts.typecheck, expected)
    assert.equal(next.scripts.check, pkg.scripts.check)
    assert.deepEqual(addCompilerScripts(next, "unused"), next)
  }
})

test("checker selection still requires a literal forced option and supported compiler arguments", () => {
  for (const script of [
    "bun check -b", "bun check -b '--no-script'", "bun run check -b --no-script",
    "bun check -b --no-script --future-build-flag", "echo 'bun check -b --no-script'",
    "bun check -b --no-script $PROJECT", "bun check -b --no-script || true"
  ]) assert.equal(replaceTsc({ typecheck: script }).typecheck, script)
})
