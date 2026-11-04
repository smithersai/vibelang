import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
export function checkFixScope(group) {
const acceptsKey = (key, suffix) => group === "all" || group === "protected" && !["../outside.json","../outside.vibe","node_modules/preset/base.json","src/internal/helper.vibex"].includes(key) || group === "membership" && key === "src/internal/helper" + suffix || group === "boundary" && ["../outside.json","../outside.vibe","node_modules/preset/base.json"].includes(key)
// run-seconds: 240
const issues = []
for (const configName of ["vibe.config.json", "tsconfig.json", "jsconfig.json"]) {
  for (const suffix of [".vibe", ".vibex"]) {
    const dir = mkdtempSync(join(tmpdir(), "vip34-fix-scope-"))
    const root = join(dir, "repo")
    const put = (file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
    const protectedFiles = new Map()
    const protect = (file, text) => { put(file, text); protectedFiles.set(file, text) }
    const typeAlias = 'import type { Effect } from "effect"; export type Run = Effect.Effect<number>;'
    const value = 'import { Effect } from "effect"; export const program = Effect.gen(function* () { return 1 });'
    try {
      mkdirSync(join(root, ".git"), { recursive: true }) // fixture repository boundary; no VCS command
      mkdirSync(join(root, "node_modules"))
      mkdirSync(join(dir, "node_modules"))
      symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(root, "node_modules/effect"))
      symlinkSync(process.env.VIBELANG_RUNTIME, join(root, "node_modules/vibelang-runtime"))
      put("package.json", '{"type":"module"}')
      put("base.json", '{ /* owned comment */ "vibelang":{"diagnostics":{"EK4610":"warning"}},"compilerOptions":{"strict":true} }')
      protect("../outside.json", '{"vibelang":{"diagnostics":{"EK4609":"off"}}}')
      protect("node_modules/preset/base.json", '{"vibelang":{"diagnostics":{"EK4609":"off"}}}')
      put("node_modules/dep/package.json", '{"name":"dep","types":"index.vibe","type":"module"}')
      protect("node_modules/dep/index.vibe", typeAlias)
      protect("../outside.vibe", typeAlias)
      put("src/main" + suffix, typeAlias + ' import type { Run as Inner } from "./internal/helper' + suffix + '"; import type { Run as Dep } from "dep"; import type { Run as Outside } from "../../outside.vibe"; export type Both = Inner | Dep | Outside;')
      put("src/internal/helper" + suffix, typeAlias)
      const selected = ["src/main" + suffix]
      for (const ext of [".ts", ".tsx", ".mts", ".d.ts", ".d.vibe.ts", ".d.vibex.ts"]) {
        const file = "src/protected" + ext
        protect(file, typeAlias)
        selected.push(file)
      }
      for (const ext of [".js", ".jsx", ".mjs"]) {
        const file = "src/protected" + ext
        protect(file, value)
        selected.push(file)
      }
      for (const [file, text] of [["out/retained.js", value], [".vibelang/js/retained.js", value], ["state.tsbuildinfo", "retained build info"], ["bun.lock", "retained lock"]]) protect(file, text)
      // An independent native TypeScript membership control reaches an excluded
      // helper through the selected source's import.
      protect("native/main.ts", 'import { value } from "./internal/helper.js"; export { value };')
      protect("native/internal/helper.ts", "export const value = 1;")
      const parsed = ts.parseJsonConfigFileContent({ compilerOptions: { noEmit: true, types: [] }, files: ["native/main.ts"], exclude: ["native/internal"] }, ts.sys, root)
      const native = ts.createProgram(parsed.fileNames, parsed.options)
      assert.ok(native.getSourceFile(join(root, "native/internal/helper.ts")))
      put(configName, JSON.stringify({
        extends: ["../outside.json", "./node_modules/preset/base.json", "./base.json"],
        compilerOptions: { strict: true, types: [], allowJs: true, jsx: "preserve", target: "ES2022", module: "NodeNext", noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true },
        files: selected, exclude: ["src/internal"],
        vibe: { effectGlobals: false, effectModules: false, severities: { EK3009: "off", EK4610: "off" } }
      }))
      const result = spawnSync(process.env.VIBELANG_BINARY, ["--fix", "-p", configName, "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.signal, null, result.stdout + result.stderr)
      const check = (key, assertion) => { try { assertion() } catch (error) { if (acceptsKey(key, suffix)) issues.push({ configName, suffix, key, error: error.message }) } }
      for (const file of ["src/main" + suffix, "src/internal/helper" + suffix]) {
        check(file, () => assert.ok(!readFileSync(join(root, file), "utf8").includes("Effect.Effect"), "owned imported source was not fixed"))
      }
      for (const [file, text] of protectedFiles) check(file, () => assert.equal(readFileSync(join(root, file), "utf8"), text, "protected file changed"))
      check("owned base", () => {
        const base = readFileSync(join(root, "base.json"), "utf8")
        assert.ok(base.includes("owned comment"))
        assert.ok(!base.includes('"diagnostics"'))
        assert.ok(base.includes('"severities"'))
      })
      check("modern entry", () => assert.equal(JSON.parse(readFileSync(join(root, configName), "utf8")).vibe.severities.EK4610, "off"))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}
if (issues.length) throw new Error("VIP-34 fix ownership/config traversal matrix: " + JSON.stringify(issues.map(({configName, suffix, key, error}) => ({configName, suffix, key, error}))))

}
