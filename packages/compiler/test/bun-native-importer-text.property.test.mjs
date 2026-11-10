import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// A native module reaches its migrated neighbour by the same extensionless
// import whatever text surrounds that import. The oracle is the TypeScript
// twin: Bun without the preload runs the program with leaf.ts, and the
// preload must print the same with leaf.vibe. opencode kept modules native
// for two such texts: a #! line (Bun 1.4.2's import scanner rejects it) and
// CommonJS words inside an ES module's template literal. alchemy kept modules
// native for a third: a property access such as ctx.exports.program in code.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const preload = fileURLToPath(new URL("../bun.mjs", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const runtime = join(repo, "packages/runtime")
const hasBun = spawnSync("bun", ["--version"]).status === 0
const missing = [native, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = !hasBun ? "bun is not on PATH" : missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`
const rule = "docs/design/src/007-tooling.md: output names follow the native twin; bundler plugins use the same names"
const regressions = new URL("./property-regressions/", import.meta.url)

const spellings = ["exports.default = 1", "module.exports = { a: 1 }", 'module["exports"] = 2', "exports[key] = 3", "Object.defineProperty(exports, \"x\", {})"]
const contexts = ["double", "single", "template", "substitution", "nested-template", "line-comment", "block-comment", "regex", "member", "optional-member", "none"]
const input = fc.record({
  shebang: fc.boolean(),
  context: fc.constantFrom(...contexts),
  spelling: fc.constantFrom(...spellings),
  extension: fc.constantFrom("ts", "js", "mts"),
  entry: fc.boolean(),
  value: fc.integer({ min: -50, max: 50 })
})
let diagnostics = ""

function literal({ context, spelling }) {
  switch (context) {
    case "double": return "const text = " + JSON.stringify(spelling)
    case "single": return "const text = '" + spelling.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
    case "template": return "const text = `\n  " + spelling + "\n`"
    case "substitution": return "const text = `${" + JSON.stringify(spelling) + "}`"
    case "nested-template": return "const text = `a ${`b ${" + JSON.stringify(spelling) + "}`} " + spelling + "`"
    case "line-comment": return "const text = \"\" // " + spelling
    case "block-comment": return "/* " + spelling + " */ const text = \"\""
    case "regex": return "const text = String(/" + spelling.replace(/[\\/[\](){}.*+?^$|]/g, "\\$&") + "/)"
    // Code, not text: a property named exports or module on an ordinary object.
    case "member": {
      const code = spelling.startsWith("Object.defineProperty") ? spelling.replace("(exports", "(holder.exports") : "holder." + spelling
      return "const holder = { exports: {}, module: { exports: {} } }\nconst key = \"k\"\n" + code + "\nconst text = JSON.stringify(holder)"
    }
    case "optional-member": {
      const read = spelling.startsWith("module") ? "holder?.module?.exports" : spelling.startsWith("exports[") ? "holder?.exports[\"k\"]" : "holder?.exports.default"
      return "const holder = { exports: { default: 1, k: 2 }, module: { exports: 3 } }\nconst text = String(" + read + ")"
    }
    case "none": return "const text = \"\""
  }
}

function filesOf(input) {
  const { shebang, extension, entry, value } = input
  const importer = "src/importer." + extension
  const code = (shebang ? "#!/usr/bin/env bun\n" : "") + [
    'import { leaf } from "./leaf"',
    literal(input),
    "export const shown = leaf + \":\" + text.length",
    entry ? "console.log(shown)" : "",
    ""
  ].join("\n")
  return {
    "package.json": '{"type":"module"}',
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true, noEmit: true, allowJs: true }, include: ["src/**/*"] }),
    [importer]: code,
    "src/main.ts": 'import { shown } from "./importer.' + (extension === "mts" ? "mjs" : "js") + '"\nconsole.log("main", shown)\n',
    leaf: "export const leaf: number = " + value + "\n"
  }
}

function check(input) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-text-")))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
    const files = filesOf(input)
    for (const [file, text] of Object.entries(files)) {
      if (file === "leaf") continue
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const entry = input.entry ? "src/importer." + input.extension : "src/main.ts"
    const run = (loaded) => spawnSync("bun", [...(loaded ? ["--preload", preload] : []), entry], {
      cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 1 << 20,
      env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), NO_COLOR: "1" }
    })
    writeFileSync(join(root, "src/leaf.ts"), files.leaf)
    const twin = run(false)
    rmSync(join(root, "src/leaf.ts"))
    writeFileSync(join(root, "src/leaf.vibe"), files.leaf)
    const migrated = run(true)
    diagnostics = JSON.stringify({ input, twin, migrated }).replaceAll(root, "<project>")
    assert.ifError(twin.error)
    assert.equal(twin.status, 0, diagnostics)
    assert.match(twin.stdout, new RegExp("^" + (input.entry ? "" : "main ") + String(input.value).replace("-", "\\-") + ":"), diagnostics)
    assert.ifError(migrated.error)
    assert.equal(migrated.status, 0, diagnostics)
    assert.equal(migrated.stdout, twin.stdout, diagnostics)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a native importer reaches a .vibe module whatever text surrounds its import (opencode)", { skip }, async (t) => {
  await checkProperty(fc, {
    name: "bun-native-importer-text", rule,
    command: "node --test test/bun-native-importer-text.property.test.mjs",
    arbitrary: input, numRuns: 30, regressions, artifacts: filesOf,
    diagnostics: () => diagnostics, check
  })
  t.diagnostic("#! line, CommonJS words in strings, templates, substitutions, comments and regular expressions, exports and module as object properties; .ts/.js/.mts importers; entry or imported")
})
