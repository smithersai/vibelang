// opencode, VIP-40: a module body is a TypeScript file stored inside a .vibe
// file, so moving it to a sibling .ts changes no run-time observation. Under the
// Bun preload a body loads from the plugin's namespace, whose path Bun takes
// for a directory of its own, and it failed with
// Cannot find module '../theme' from 'vibelang-module:...a.vibe.platform.js',
// and the same for a package subpath and an imports map.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const preload = fileURLToPath(new URL("../bun.mjs", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const bun = process.env.VIBELANG_TEST_BUN || "bun"
const skip = spawnSync(bun, ["--version"]).status !== 0 ? "Bun is required" : spawnSync(compiler, ["--version"]).status !== 0 && "build the native compiler"
const rule = "A body is a TypeScript file stored inside a `.vibe` file."

// Each form names a target from src/sub/, with the value it holds.
const forms = {
  "extensionless ts": ['"../theme"', "theme"],
  "explicit ts": ['"../theme.ts"', "theme"],
  "js name of a ts": ['"../theme.js"', "theme"],
  "extensionless tsx": ['"../view"', "view"],
  "directory index": ['"../dir"', "dir"],
  "directory slash": ['"../dir/"', "dir"],
  "same directory": ['"./near"', "near"],
  "extensionless vibe": ['"../sib"', "sib"],
  "imports map": ['"#cond"', "cond"],
  "package subpath": ['"dep/sub"', "dep"],
  // opencode core/worktree/strategies: a file of the same name one directory up must not win.
  "vibe with a parent twin": ['"./twin.vibe"', "near-twin"],
  "js name of a vibe with a parent twin": ['"./twin.js"', "near-twin"],
  "js name of a ts with a parent twin": ['"./tstwin.js"', "near-tstwin"]
}

function run(input) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bun-module-body-")))
  const put = (file, source) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
  try {
    put("package.json", JSON.stringify({ type: "module", imports: { "#cond": { bun: "./src/cond.bun.ts", default: "./src/cond.ts" } } }))
    put("bunfig.toml", "preload = [" + JSON.stringify(preload) + "]\n")
    put("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true, types: [], jsx: "preserve", allowImportingTsExtensions: true, allowArbitraryExtensions: true }, include: ["src"] }))
    put("node_modules/dep/package.json", JSON.stringify({ name: "dep", type: "module", exports: { "./sub": { types: "./sub.d.ts", default: "./sub.js" } } }))
    put("node_modules/dep/sub.js", 'export const value = "dep"\n')
    put("node_modules/dep/sub.d.ts", "export declare const value: string\n")
    for (const [file, value] of [["theme.ts", "theme"], ["view.tsx", "view"], ["dir/index.ts", "dir"], ["sub/near.ts", "near"], ["cond.bun.ts", "cond"], ["cond.ts", "wrong"]]) {
      put("src/" + file, `export const value = ${JSON.stringify(value)}\n`)
    }
    put("src/sib.vibe", 'export const value = "sib"\n')
    put("src/twin.vibe", 'export const value = "parent-twin"\n')
    put("src/sub/twin.vibe", 'export const value = "near-twin"\n')
    put("src/tstwin.vibe", 'export const value = "parent-tstwin"\n')
    put("src/sub/tstwin.ts", 'export const value = "near-tstwin"\n')
    const names = input.forms.map((_, i) => "v" + i)
    const imports = input.forms.map((form, i) => input.dynamic
      ? `const ${names[i]} = (await import(${forms[form][0]})).value`
      : `import { value as ${names[i]} } from ${forms[form][0]}`)
    const body = imports.join("\n") + `\nexport const all = [${names.join(", ")}].join(",")\n`
    put("src/sub/body.ts", body)
    put("src/sub/inline.vibe", `module ${input.name} {\n${body}}\nexport { all } from ${input.name}\n`)
    const outcome = (module) => {
      put("main.ts", `import { all } from ${JSON.stringify(module)}\nconsole.log(all)\n`)
      const r = spawnSync(bun, ["main.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: compiler } })
      return { status: r.status, stdout: r.stdout.trim(), stderr: r.status === 0 ? "" : r.stderr.slice(-800) }
    }
    const inline = outcome("./src/sub/inline.vibe")
    const sibling = outcome("./src/sub/body.ts")
    assert.equal(sibling.status, 0, "control: " + sibling.stderr)
    assert.deepEqual(inline, sibling)
    assert.equal(inline.stdout, input.forms.map((form) => forms[form][1]).join(","))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  return true
}

test("a body's imports resolve as the same file's do beside the module", { skip }, () => checkProperty(fc, {
  name: "bun-module-body-imports", rule, command: "node --test packages/compiler/test/bun-module-body.property.test.mjs",
  regressions: new URL("./property-regressions/", import.meta.url), numRuns: 16,
  arbitrary: fc.record({
    forms: fc.uniqueArray(fc.constantFrom(...Object.keys(forms)), { minLength: 1, maxLength: 5 }),
    dynamic: fc.boolean(),
    name: fc.constantFrom("platform", "host", "m1")
  }),
  check: run
}))
