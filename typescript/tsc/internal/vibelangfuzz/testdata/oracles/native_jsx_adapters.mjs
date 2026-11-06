import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import vm from "node:vm"

const root = process.cwd(), runtimeRequire = createRequire(join(root, "packages/runtime/package.json"))
const ts = runtimeRequire("typescript")
const [area, key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 7
const data = join(root, "typescript/tsc/internal/vibelangfuzz/testdata")
if (area === "babel") {
  const witness = readFileSync(join(data, "corpus/t3code-babel-native-file.vibex"), "utf8")
  assert.equal(witness, "export interface Props { readonly value: string }\nexport const text = (props: Props): string => props.value;\n")
  const models = {
    interface: witness,
    "generic-arrow": "export const identity = <A,>(value: A): A => value;\n",
    enum: "export enum Status { Ready, Done }\nexport const value: Status = Status.Ready;\n",
    "class-field": "export class Value { readonly value: string = 'ready'; }\n",
    jsx: "export interface Props { readonly value: string }\nexport const View = (props: Props) => <div>{props.value}</div>;\n"
  }
  assert.ok(Object.hasOwn(models, key))
  let source = models[key]
  if (mode & 4) source = source.replaceAll("\n", "\r\n")
  const extension = key === "jsx" || mode & 1 ? "vibex" : "vibe"
  const file = (mode & 2 ? "nested/space δ/" : "src/") + "probe." + extension
  const bridgeCalls = [], parseCalls = [], remaps = []
  const transpile = (file, code) => {
    const result = ts.transpileModule(code, {
      fileName: file.endsWith(".vibex") ? "input.tsx" : "input.ts", reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
    })
    assert.deepEqual(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [])
    return result.outputText
  }
  const compiled = transpile(file, source), marker = {}
  const fakeEmit = {
    toolSource(file, code) {
      bridgeCalls.push({ file, code })
      if (code === "export const alreadyCompiled = true;\n") return undefined
      return { code: transpile(file, code), map: marker }
    },
    remapLocations(ast, map) { assert.equal(map, marker); remaps.push(ast); return ast }
  }
  const module = { exports: {} }
  vm.runInNewContext(readFileSync(join(root, "packages/compiler/babel.cjs"), "utf8"), {
    module, require(name) { assert.equal(name, "./emit.mjs"); return fakeEmit }
  }, { filename: "babel.cjs" })
  const plugin = module.exports().plugins[0]()
  const parsed = { type: "File" }
  const parse = (code, options) => { parseCalls.push({ code, options }); return parsed }
  for (const foreign of ["foreign.ts", "foreign.tsx", "foreign.js", "foreign.jsx", null, undefined]) {
    assert.equal(plugin.parserOverride(source, { sourceFileName: foreign }, parse), undefined)
    assert.equal(bridgeCalls.length, 0)
    assert.equal(parseCalls.length, 0)
  }
  assert.equal(plugin.parserOverride("export const alreadyCompiled = true;\n", { sourceFileName: "already.vibe" }, parse), undefined)
  assert.equal(parseCalls.length, 0)
  bridgeCalls.length = 0
  const controlSource = key === "jsx" ? witness : source
  assert.equal(plugin.parserOverride(controlSource, { sourceFileName: "control.vibe" }, parse), parsed)
  assert.equal(bridgeCalls.length, 1)
  assert.equal(parseCalls.length, 1)
  assert.equal(parseCalls[0].code, transpile("control.vibe", controlSource))
  bridgeCalls.length = parseCalls.length = remaps.length = 0
  const result = plugin.parserOverride(source, { sourceFileName: file }, parse)
  console.log(JSON.stringify({
    ok: result === parsed && bridgeCalls.length === 1 && parseCalls.length === 1 &&
      parseCalls[0].code === compiled && remaps.length === 1,
    key, extension, bridgeCalls: bridgeCalls.length, parseCalls: parseCalls.length, remaps: remaps.length
  }))
} else if (area === "router") {
  assert.ok(["vibex", "vibe", "tsx-control"].includes(key))
  const fixture = JSON.parse(readFileSync(join(data, "corpus/t3code-tanstack-native-route.json"), "utf8"))
  const require = createRequire(join(root, "packages/compiler/test/tools/package.json"))
  await import(pathToFileURL(join(root, "packages/compiler/register.mjs")))
  const { Generator, getConfig } = require("@tanstack/router-generator")
  const { planScope } = await import(pathToFileURL(join(root, ".smithers/flows/migrate/lib/onepass.mjs")))
  mkdirSync(join(root, ".cache"), { recursive: true })
  const temp = mkdtempSync(join(root, ".cache/native-router-"))
  const put = (name, text) => { mkdirSync(dirname(join(temp, name)), { recursive: true }); writeFileSync(join(temp, name), text) }
  try {
    const stem = (mode & 2 ? "parent/" : "") + (mode & 1 ? "settings" : "welcome")
    const originalExtension = key === "vibe" ? "ts" : "tsx"
    const route = "/" + stem
    let source = fixture.route.replaceAll("/welcome", route)
    if (key === "vibe") source = source.replace("<div>Welcome</div>", "null")
    if (mode & 4) source = source.replaceAll("\n", "\r\n")
    put("package.json", '{"type":"module"}')
    put("tsconfig.json", '{"compilerOptions":{"jsx":"react-jsx","types":[]},"include":["routes"]}')
    put("helper.ts", "export const helper = 1;\n")
    put("routes/__root.tsx", fixture.root)
    put("routes/kept.tsx", fixture.route.replaceAll("/welcome", "/kept"))
    put("routes/" + stem + "." + originalExtension, source)
    async function generate() {
      const config = getConfig({ routesDirectory: "./routes", generatedRouteTree: "./routeTree.gen.ts", disableLogging: true }, temp)
      await new Generator({ config, root: temp }).run()
      const text = readFileSync(join(temp, "routeTree.gen.ts"), "utf8")
      const tree = ts.createSourceFile("routeTree.gen.ts", text, ts.ScriptTarget.Latest, true)
      assert.deepEqual(tree.parseDiagnostics, [])
      const imports = [], paths = []
      const canonical = value => /\.d\.vibex?$/.test(value) ? value : value.replace(/\.vibex?$/, "")
      function visit(node) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith("./routes/")) imports.push(canonical(node.moduleSpecifier.text))
        if (ts.isStringLiteral(node) && node.text.startsWith("/")) paths.push(node.text)
        ts.forEachChild(node, visit)
      }
      visit(tree)
      return { imports: [...new Set(imports)].sort(), paths: [...new Set(paths)].sort() }
    }
    const before = await generate()
    assert.ok(before.imports.includes("./routes/" + stem))
    assert.ok(before.imports.includes("./routes/kept"))
    assert.ok(before.paths.includes(route))
    const extension = key === "tsx-control" ? "tsx" : key
    const originalFile = "routes/" + stem + "." + originalExtension
    const originalBytes = readFileSync(join(temp, originalFile), "utf8")
    const plan = planScope(temp, [originalFile, "helper.ts"])
    const selected = plan.batches.flatMap(batch => batch.files)
    assert.ok(selected.includes("helper.ts"), "a plain independent module remains eligible")
    assert.equal(readFileSync(join(temp, originalFile), "utf8"), originalBytes, "planning must not edit the route")
    const nativeSelected = selected.includes(originalFile)
    const refusal = plan.deferred.find(item => item.file === originalFile)
    if (!nativeSelected) assert.ok(refusal && typeof refusal.reason === "string" && refusal.reason.length, "retained route needs a located deferral")
    if (key !== "tsx-control" && nativeSelected) {
      renameSync(join(temp, originalFile), join(temp, "routes/" + stem + "." + key))
      put("routes/" + stem + ".d." + key + ".ts", fixture.declaration)
    }
    const after = await generate()
    assert.ok(after.imports.includes("./routes/kept"), "an unrelated authored route must remain selected")
    console.log(JSON.stringify({ ok: JSON.stringify(before) === JSON.stringify(after), key, extension, before, after, nativeSelected, locatedDeferral: refusal?.reason ?? null, dependency: "@tanstack/router-generator@1.167.12" }))
  } finally { rmSync(temp, { recursive: true, force: true }) }
} else throw Error("unknown native adapter area")
