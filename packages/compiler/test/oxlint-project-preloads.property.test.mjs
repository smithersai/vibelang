import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"

const adapter = new URL("../oxlint.mjs", import.meta.url).href
function verify(mode, suffix, equal) {
  const root = mkdtempSync(join(tmpdir(), "oxlint-project-preload-"))
  try {
    const name = "preload-" + suffix, module = join(root, "node_modules", name)
    mkdirSync(module, { recursive: true })
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(module, "package.json"), JSON.stringify({
      name, type: "module", exports: { import: "./import.mjs", require: "./require.cjs" },
    }))
    writeFileSync(join(module, "import.mjs"), 'globalThis.preloadFixture = "import";')
    writeFileSync(join(module, "require.cjs"), 'globalThis.preloadFixture = "require";')
    writeFileSync(join(root, "entry.vibe"), "export const value = 1\n")
    writeFileSync(join(root, "compiler.mjs"),
      'import fs from "node:fs"; process.stdout.write(JSON.stringify({text:fs.readFileSync(0,"utf8"),extension:".ts",mappings:[]}));')
    writeFileSync(join(root, "engine.mjs"), [
      'import fs from "node:fs"; import assert from "node:assert/strict";',
      'assert.equal(globalThis.preloadFixture,' + JSON.stringify(mode) + ');',
      'fs.appendFileSync(' + JSON.stringify(join(root, "calls.jsonl")) + ',JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),options:process.env.NODE_OPTIONS,source:fs.existsSync("entry.ts"),config:fs.existsSync(".oxlintrc.json")})+"\\n");',
      'console.log(JSON.stringify(process.argv.includes("--print-config")?{rules:{"no-debugger":["error"]}}:{diagnostics:[],number_of_files:1,number_of_rules:1,threads_count:1}));',
    ].join("\n"))
    writeFileSync(join(root, "run.mjs"), [
      'import { fileURLToPath } from "node:url"; import {lintProjected,printProjectedConfig} from ' + JSON.stringify(adapter) + ';',
      'const options={base:process.cwd(),binary:fileURLToPath(new URL("./engine.mjs",import.meta.url)),compiler:fileURLToPath(new URL("./compiler.mjs",import.meta.url)),paths:["entry.vibe"],config:{categories:{correctness:"off"}}};',
      'const result=await lintProjected(options); const printed=printProjectedConfig(options);',
      'console.log(JSON.stringify({status:result.status,files:result.output.number_of_files,rules:JSON.parse(printed).rules}));',
    ].join("\n"))
    const option = "--" + mode + (equal ? "=" : " ") + name
    const run = spawnSync(process.execPath, ["run.mjs"], {
      cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: option + " --no-warnings" }, timeout: 30000,
    })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), { status: 0, files: 1, rules: { "no-debugger": ["error"] } })
    const calls = readFileSync(join(root, "calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.equal(calls.length, 2, "lint and print-config both run the native engine")
    assert.equal(calls[0].source, true, "lint the projected source in its temporary tree")
    for (const call of calls) {
      assert.notEqual(call.cwd, root, "native configuration still resolves in the virtual tree")
      assert.equal(call.config, true)
      assert.equal(call.options, option + " --no-warnings", "retain other Node options")
    }
    assert.ok(calls[1].args.includes("--print-config"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("native Oxlint resolves project package preloads before entering its virtual tree", () => {
  verify("import", "witness", true)
  for (const mode of ["import", "require"]) for (const equal of [true, false]) verify(mode, "control", equal)
  fc.assert(fc.property(
    fc.constantFrom("import", "require"),
    fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/),
    fc.boolean(),
    verify,
  ), { numRuns: 36 })
})
