import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const here = fileURLToPath(new URL(".", import.meta.url))
const rule = "Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."
const regressions = new URL("./property-regressions/", import.meta.url)
const bundled = ["bun", "rolldown", "vite", "esbuild", "webpack", "rspack"]
const selected = (process.env.SOURCE_CONDITION_BUNDLERS || bundled.join(",")).split(",")
let diagnostics = ""
assert.ok(selected.every(name => bundled.includes(name)), "unknown source-condition bundler")

test("the spec requires bundlers to read VibeLang sources", () => {
  const spec = readFileSync(join(workspace, "docs/design/src/007-tooling.md"), "utf8")
  assert.ok(spec.includes(rule), "update the source-condition oracle when Chapter 7 changes")
})

function write(root, file, text) {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)
}

function fixture(shape) {
  const base = join(here, ".fixtures")
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, "source-conditions-"))
  const segment = shape.nested ? "nested/" : ""
  const leaf = segment + "entry"
  const token = segment + "token"
  const key = shape.kind === "root" ? "." : shape.kind === "pattern" ? "./*" : "./" + leaf
  const target = shape.kind === "pattern" ? "*" : leaf
  const source = shape.migrated ? ".vibe" : ".ts"
  let entry = shape.migrated
    ? { types: "./src/" + target + ".d.vibe.ts", "vibelang-source": "./src/" + target + ".vibe", default: "./.vibelang/js/src/" + target + ".js" }
    : "./src/" + target + ".ts"
  if (shape.wrapper === "import") entry = { import: entry }
  if (shape.wrapper === "array") entry = [entry]
  write(root, "package.json", JSON.stringify({ type: "module", workspaces: ["packages/*"] }))
  write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, types: [], skipLibCheck: true, noEmit: true }, include: ["src", "packages"], vibe: { effectGlobals: false, effectModules: false } }))
  write(root, "packages/lib/package.json", JSON.stringify({ name: "lib", type: "module", exports: { [key]: entry, ["./" + token]: "./src/" + token + ".ts" } }))
  write(root, "packages/lib/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.json", include: ["src"] }))
  write(root, "packages/lib/src/" + token + ".ts", "export const token = { key: 'shared' }\n")
  write(root, "packages/lib/src/" + leaf + source, 'export { token } from "./token.ts"\n')
  if (shape.migrated) {
    write(root, "packages/lib/src/" + leaf + ".d.vibe.ts", 'export { token } from "./token.js"\n')
    write(root, "packages/lib/.vibelang/js/src/" + token + ".js", "export const token = { key: 'shared' }\n")
    write(root, "packages/lib/.vibelang/js/src/" + leaf + ".js", 'export { token } from "./token.js"\n')
  }
  const specifier = shape.kind === "root" ? "lib" : "lib/" + leaf
  const imports = shape.dynamic
    ? `const { token: a } = await import(${JSON.stringify(specifier)}); const { token: b } = await import(${JSON.stringify("lib/" + token)});`
    : `import { token as a } from ${JSON.stringify(specifier)}; import { token as b } from ${JSON.stringify("lib/" + token)};`
  write(root, "src/main.ts", imports + ' import policy from "policy"; console.log(JSON.stringify({ same: a === b, policy }))\n')
  write(root, "node_modules/policy/package.json", JSON.stringify({ name: "policy", type: "module", exports: { custom: "./custom.js", module: "./module.js", node: "./node.js", browser: "./browser.js", default: "./default.js" } }))
  for (const condition of ["custom", "module", "node", "browser", "default"]) write(root, "node_modules/policy/" + condition + ".js", "export default " + JSON.stringify(condition))
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(join(root, "packages/lib"), join(root, "node_modules/lib"))
  symlinkSync(join(workspace, "packages/compiler"), join(root, "node_modules/vibelang"))
  symlinkSync(join(workspace, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES || join(workspace, "experiments/node_modules"), "effect"), join(root, "node_modules/effect"))
  return root
}

function run(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 4 << 20 })
  diagnostics = (result.stdout || "") + (result.stderr || "")
  assert.equal(result.status, 0, diagnostics)
  return result.stdout.trim()
}

function bundle(root, adapter, plugin, custom) {
  const options = JSON.stringify({ root, adapter, plugin, custom, workspace })
  const script = `
import { writeFileSync } from "node:fs"
const {root,adapter,plugin,custom,workspace}=${options}
const entry=root+"/src/main.ts", outfile=root+"/bundle.mjs"
const adapterRoot=workspace+"/packages/unplugin"
const load=(name)=>import(import.meta.resolve(name,{parent:adapterRoot+"/package.json"}))
const conditions=custom?["custom","import"]:undefined
const plugins=plugin?[(await import(adapter==="vite"?workspace+"/packages/vite/src/index.js":adapterRoot+"/src/"+adapter+".js")).default({root})]:[]
if(adapter==="bun"){
  const result=await Bun.build({entrypoints:[entry],target:"bun",conditions,plugins})
  if(!result.success)throw new Error(result.logs.map(String).join("\\n"))
  writeFileSync(outfile,await result.outputs[0].text())
}else if(adapter==="rolldown"){
  const {rolldown}=await import(adapterRoot+"/node_modules/rolldown/dist/index.mjs")
  const b=await rolldown({input:entry,platform:"node",resolve:conditions?{conditionNames:conditions}:{},plugins,onLog(){}})
  const {output}=await b.generate({format:"es",inlineDynamicImports:true});writeFileSync(outfile,output[0].code);await b.close()
}else if(adapter==="vite"){
  const {build}=await import(adapterRoot+"/node_modules/vite/dist/node/index.js")
  const result=await build({root,configFile:false,logLevel:"silent",plugins,ssr:{noExternal:["lib","policy"],resolve:conditions?{conditions}:{}},build:{ssr:entry,write:false,rolldownOptions:{output:{inlineDynamicImports:true}}}})
  writeFileSync(outfile,result.output[0].code)
}else if(adapter==="esbuild"){
  const {build}=await import(adapterRoot+"/node_modules/esbuild/lib/main.js")
  const result=await build({entryPoints:[entry],bundle:true,platform:"node",format:"esm",conditions,plugins,write:false,logLevel:"silent"})
  writeFileSync(outfile,result.outputFiles[0].text)
}else{
  const create=adapter==="webpack"?(await import(adapterRoot+"/node_modules/webpack/lib/index.js")).default:(await import(adapterRoot+"/node_modules/@rspack/core/dist/index.js")).rspack
  const compiler=create({mode:"none",context:root,target:"node",entry,output:{path:root,filename:"bundle.mjs",module:true,chunkFormat:"module",library:{type:"module"}},experiments:{outputModule:true},resolve:{conditionNames:conditions??["..."]},plugins,infrastructureLogging:{level:"error"}})
  const stats=await new Promise((ok,fail)=>compiler.run((e,s)=>compiler.close(()=>e?fail(e):ok(s))))
  if(stats.hasErrors())throw new Error(stats.toString("errors-only"))
}
`
  write(root, "build.mjs", script)
  run(root, adapter === "bun" ? "bun" : "node", [join(root, "build.mjs")])
  return JSON.parse(run(root, adapter === "bun" ? "bun" : "node", [join(root, "bundle.mjs")]))
}

async function compare(shape) {
  const baseline = fixture({ ...shape, migrated: false })
  const migrated = fixture({ ...shape, migrated: true })
  try {
    const expected = bundle(baseline, shape.adapter, false, shape.custom)
    const actual = bundle(migrated, shape.adapter, true, shape.custom)
    assert.equal(expected.same, true)
    assert.deepEqual(actual, expected, JSON.stringify(shape))
  } finally {
    rmSync(baseline, { recursive: true, force: true })
    rmSync(migrated, { recursive: true, force: true })
  }
}

for (const adapter of selected) {
  test("opencode-49: " + adapter + " preserves mixed-package identity and native conditions", () => compare({ adapter, kind: "exact", wrapper: "direct", nested: false, dynamic: false, custom: false }))
}

test("property: source export conditions preserve the native package graph", async () => {
  await checkProperty(fc, {
    name: "source-export-module-identity", rule, command: "node --test test/source-conditions.property.test.mjs",
    arbitrary: fc.record({ adapter: fc.constantFrom(...selected), kind: fc.constantFrom("exact", "pattern", "root"), wrapper: fc.constantFrom("direct", "import", "array"), nested: fc.boolean(), dynamic: fc.boolean(), custom: fc.boolean() }),
    check: compare, numRuns: 24, regressions, diagnostics: () => diagnostics
  })
})
