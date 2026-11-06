import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const repo = process.cwd()
const require = createRequire(join(repo, "docs/tools/package.json"))
const ts = require("typescript")
const { compareDeclarations, recordDeclarationSurface } = await import(pathToFileURL(join(repo, ".smithers/flows/migrate/lib/declarations.mjs")))
const corpus = JSON.parse(readFileSync(new URL("../corpus/t3code-original-self-projected-alias.json", import.meta.url), "utf8"))
const input = JSON.parse(readFileSync(0, "utf8"))
const root = mkdtempSync(join(tmpdir(), "declaration-alias-self-"))
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const tree = directory => {
  const result = {}
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else result[relative(root, path)] = readFileSync(path).toString("base64")
    }
  }
  visit(directory)
  return result
}
const diagnostics = errors => errors.map(error => ({ code: error.code, message: ts.flattenDiagnosticMessageText(error.messageText, "\n") }))

try {
  const pkg = join(root, "repo/apps/desktop"), snapshot = join(root, "dts")
  const key = input.key, shape = input.shape & 63
  const depth = shape & 3, stem = shape & 16 ? "errors" : "a"
  const folder = "src/" + "nested/".repeat(depth)
  const extension = key.endsWith("-js") ? ".js" : ".ts"
  const name = shape & 8 ? "Fault" : "Failure"
  const namespace = shape & 4 ? "Module" : "A"
  let files = { ...corpus.files }
  if (key.startsWith("named-")) files["src/index.ts"] = 'import { Failure, make } from "./a.ts";\nexport const factory: () => Failure = make;\n'
  if (key === "interface-ts") files["src/a.ts"] = 'export interface Failure { readonly message: string }\nexport function make(): Failure { return { message: "failure" }; }\n'
  for (const [file, original] of Object.entries(files)) {
    let text = original.replace(/\bFailure\b/g, name).replace(/\bA\b/g, namespace).replaceAll("./a.ts", "./" + stem + extension)
    if (shape & 32) text = text.replaceAll("\n", "\r\n")
    put(join(pkg, folder, file.endsWith("a.ts") ? stem + ".ts" : "index.ts"), text)
  }
  put(join(pkg, "package.json"), JSON.stringify({ private: true, type: "module" }))
  const compilerOptions = { target: "esnext", module: "nodenext", moduleResolution: "nodenext", strict: true, skipLibCheck: true, allowImportingTsExtensions: true, types: [], declaration: true, emitDeclarationOnly: true }
  if (key !== "no-suffix-ts") compilerOptions.moduleSuffixes = ["", ".d.vibe"]
  put(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions }))
  const configFile = join(root, "run/dts.json")
  put(configFile, JSON.stringify({ extends: "../repo/apps/desktop/tsconfig.json", compilerOptions: { rootDir: "../repo" }, include: ["../repo/apps/desktop/**/*"] }))
  const config = ts.readConfigFile(configFile, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configFile), undefined, configFile)
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, outDir: snapshot })
  const emitted = program.emit()
  const errors = diagnostics([...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics])
  if (errors.length || emitted.emitSkipped) throw new Error("original TypeScript emit failed: " + JSON.stringify(errors))
  recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "../../../run/dts.json", prefix: "." }])
  const stockSelf = input.controls ? compareDeclarations(ts, snapshot, snapshot, { includePrivate: true }) : null
  let explicitOutputSelf
  if (input.controls) {
    // A configured output directory is a distinct working control. The original
    // minimized command supplies that directory only on the command line.
    const externalConfig = readFileSync(configFile, "utf8")
    const explicitConfig = JSON.parse(externalConfig)
    explicitConfig.compilerOptions.outDir = "../dts"
    put(configFile, JSON.stringify(explicitConfig))
    recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "../../../run/dts.json", prefix: "." }])
    explicitOutputSelf = compareDeclarations(ts, snapshot, snapshot, { includePrivate: true })
    put(configFile, externalConfig)
  }
  rmSync(snapshot, { recursive: true, force: true })
  const native = spawnSync(input.compiler, ["-p", configFile, "--singleThreaded", "--declaration", "--emitDeclarationOnly", "--outDir", snapshot], { cwd: pkg, encoding: "utf8", timeout: 30000 })
  if (native.status !== 0 || native.error) throw new Error("original native TypeScript emit failed: " + native.status + " " + native.stdout + native.stderr)
  recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "../../../run/dts.json", prefix: "." }])
  const before = tree(snapshot)
  const self = compareDeclarations(ts, snapshot, snapshot, { includePrivate: true })
  const unchanged = JSON.stringify(before) === JSON.stringify(tree(snapshot))
  const controls = []
  if (input.controls) {
    controls.push({ name: "explicit-output-self", ok: explicitOutputSelf.comparisonComplete === true && explicitOutputSelf.identical === true })
    const controlRoot = join(root, "controls")
    const control = (name, before, after, expect) => {
      const a = join(controlRoot, name, "before"), b = join(controlRoot, name, "after")
      for (const [path, text] of [[a, before], [b, after]]) {
        put(join(path, "package.json"), JSON.stringify({ private: true, type: "module", types: "./index.d.ts" }))
        put(join(path, "index.d.ts"), text)
      }
      const result = compareDeclarations(ts, a, b, { includePrivate: true })
      controls.push({ name, ok: expect(result), complete: result.comparisonComplete, identical: result.identical })
    }
    const ordinary = "/** Original documentation. */\nexport declare const value: number;\n"
    control("ordinary-self", ordinary, ordinary, r => r.comparisonComplete === true && r.identical === true)
    control("changed-type", ordinary, ordinary.replace("number", "string"), r => r.comparisonComplete === true && r.identical === false)
    control("changed-name", ordinary, ordinary.replace("value", "renamed"), r => r.comparisonComplete === true && r.identical === false)
    control("changed-doc", ordinary, ordinary.replace("Original", "Changed"), r => r.comparisonComplete === true && r.identical === false)
    const unresolved = 'import type { Missing } from "./missing.js";\nexport declare const value: Missing;\n'
    control("unresolved-self", unresolved, unresolved, r => r.comparisonComplete === false && r.identical === false)
  }
  console.log(JSON.stringify({ errors, unchanged, controls, self, stockSelf, version: ts.version, declarationFiles: Object.keys(before).filter(p => p.endsWith(".d.ts")).length }))
} finally { rmSync(root, { recursive: true, force: true }) }

