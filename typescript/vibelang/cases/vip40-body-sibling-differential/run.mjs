// VIP-40's copy rule, checked as the differential test it names.
// rule-evidence: docs/design/vips/0040-module-declarations.md#3183e8f7970e7219
// The rule is falsifiable by a differential test: compile every TypeScript module of the corpus once as a body and once as a sibling `.ts` or `.tsx` of the same source kind, preserving external-module classification in both, and compare.
// rule-evidence: docs/design/vips/0040-module-declarations.md#d0c87dee9ad7aeeb
// **Module classification.** A body is always an external module before binding and checking, even without a written import or export and regardless of `moduleDetection`.
// rule-evidence: docs/design/vips/0040-module-declarations.md#19c23eaac717a1a9
// For example, `module privateState { const privateBodyValue = 7 }` imported by `import privateState;` keeps `privateBodyValue` private even with `moduleDetection: "legacy"`.
// rule-evidence: docs/design/vips/0040-module-declarations.md#e2ac3a407109be66
// A consumer containing `import "./privateState.js"; export const leaked = privateBodyValue` reports `TS2304` in both forms.
// rule-evidence: docs/design/vips/0040-module-declarations.md#6f4e4d775a2cfa82
// Writing these same tokens to `view.ts` instead reports TypeScript's `TS1005`; a `jsx` compiler option does not turn a `.ts` file into a `.tsx` file.
// run-seconds: 300
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const vibelang = process.env.VIBELANG_BINARY
const modules = process.env.EFFECT_NODE_MODULES
assert.ok(vibelang && modules, "VIBELANG_BINARY and EFFECT_NODE_MODULES name this workspace's compiler and dependencies")
const tsc = join(modules, "typescript/bin/tsc")

// Each corpus module is ordinary TypeScript. A module with no import or
// export is a script under legacy detection, so its twin carries the marker.
const corpus = {
  privateState: "const privateBodyValue = 7",
  scriptState: "let counter = 0\nfunction tick(): number { return ++counter }\ntick()",
  port: "/** @throws {RangeError} */\nexport function port(raw: string): number {\n  const n = Number(raw)\n  if (!Number.isInteger(n)) throw new RangeError(\"bad port: \" + raw)\n  return n\n}\nexport const first = port(\"80\")",
  live: "export let count = 0\nexport function bump(): number { return ++count }\nbump()",
  types: "export interface Shape { readonly side: number }\nexport type Side = Shape[\"side\"]\nexport const unit: Shape = { side: 1 }",
  classes: "export class Box<T> {\n  #value: T\n  constructor(value: T) { this.#value = value }\n  get value(): T { return this.#value }\n}\nexport const boxed = new Box(\"x\").value",
  mistyped: "export const n: number = \"x\"",
  unknownName: "export const leaked = notDeclaredAnywhere",
  awaited: "export const ready = await Promise.resolve(3)",
}

// The output stem of a body: VIP-40 keeps a-z, 0-9 and _ and writes every
// other code point as -, its lowercase hexadecimal code point, and -.
const stem = name => "main.vibe." + [...name].map(c => /[a-z0-9_]/.test(c) ? c : "-" + c.codePointAt(0).toString(16) + "-").join("")
const hasModuleSyntax = text => /^\s*(?:import|export)\b/m.test(text)

function project(dir, moduleDetection, files) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "node_modules"), { recursive: true })
  symlinkSync(join(modules, "effect"), join(dir, "node_modules/effect"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2022", module: "esnext", moduleResolution: "bundler", moduleDetection, strict: true,
      types: [], skipLibCheck: true, declaration: true, rewriteRelativeImportExtensions: true, outDir: "out"
    },
    vibe: { effectGlobals: false, effectModules: false },
    include: ["*.vibe", "*.ts"]
  }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
}

function compile(compiler, dir) {
  const args = compiler === tsc ? [tsc] : []
  const r = spawnSync(compiler === tsc ? process.execPath : compiler, [...args, "-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
  assert.equal(r.error, undefined, String(r.error))
  assert.equal(r.signal, null, r.stdout + r.stderr)
  // Positions differ by the body's line in the .vibe file; codes and text do not.
  return [...(r.stdout + r.stderr).matchAll(/error (TS\d+): (.*)/g)].map(m => m[1] + " " + m[2]).sort()
}

const read = path => existsSync(path) ? readFileSync(path, "utf8").replace(/\/\/# sourceMappingURL=.*\n?/g, "") : undefined

function observe(dir) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    'const m = await import("./out/main.js"); console.log(JSON.stringify(Object.entries(m).sort()))'], { cwd: dir, encoding: "utf8", timeout: 30000 })
  return r.status === 0 ? r.stdout : "throws " + (r.stderr.match(/^\w*Error.*$/m) ?? [r.stderr])[0]
}

const root = mkdtempSync(join(tmpdir(), "vip40-body-differential-"))
const issues = []
try {
  for (const moduleDetection of ["legacy", "auto", "force"]) {
    for (const [name, text] of Object.entries(corpus)) {
      const key = name + "/" + moduleDetection
      const consumer = 'import "./main.vibe"\nexport const leaked = privateBodyValue\n'
      const bodyDir = join(root, "body-" + key.replace("/", "-"))
      project(bodyDir, moduleDetection, {
        "main.vibe": "module " + name + " {\n" + text + "\n}\nimport " + name + "\nexport * from " + name + "\n",
        ...(name === "privateState" ? { "consumer.ts": consumer } : {})
      })
      const twinText = text + (hasModuleSyntax(text) ? "\n" : "\nexport {}\n")
      const twinDir = join(root, "twin-" + key.replace("/", "-"))
      project(twinDir, moduleDetection, {
        [name + ".ts"]: twinText,
        "main.vibe": "import \"./" + name + ".ts\"\nexport * from \"./" + name + ".ts\"\n",
        ...(name === "privateState" ? { "consumer.ts": 'import "./privateState.js"\nexport const leaked = privateBodyValue\n' } : {})
      })
      try {
        const body = compile(vibelang, bodyDir), twin = compile(vibelang, twinDir)
        assert.deepEqual(body, twin, key + ": diagnostics")
        if (name === "privateState") assert.deepEqual(body, ["TS2304 Cannot find name 'privateBodyValue'."], key)
        assert.equal(read(join(bodyDir, "out/" + stem(name) + ".js")), read(join(twinDir, "out/" + name + ".js")), key + ": emitted statements")
        assert.equal(read(join(bodyDir, "out/" + stem(name) + ".d.ts")), read(join(twinDir, "out/" + name + ".d.ts")), key + ": declaration")
        assert.equal(read(join(bodyDir, "out/main.js")).replaceAll("./" + stem(name) + ".js", "./" + name + ".js"), read(join(twinDir, "out/main.js")), key + ": importer")
        if (!body.length) assert.equal(observe(bodyDir), observe(twinDir), key + ": run-time observation")
        // The twin is ordinary TypeScript: stock tsc reports what the body reports.
        rmSync(join(twinDir, "main.vibe"))
        writeFileSync(join(twinDir, "main.ts"), "import \"./" + name + ".ts\"\nexport * from \"./" + name + ".ts\"\n")
        assert.deepEqual(compile(tsc, twinDir), body, key + ": stock tsc twin")
      } catch (error) { issues.push(error) }
    }
    // Without the marker, the unchanged copy is a script under legacy and (for
    // this module kind) auto detection, and leaks its name: so the marker, not the copy, is the twin.
    const scriptDir = join(root, "script-" + moduleDetection)
    project(scriptDir, moduleDetection, {
      "privateState.ts": "const privateBodyValue = 7\n",
      "consumer.ts": 'import "./privateState.js"\nexport const leaked = privateBodyValue\n',
    })
    const leaked = compile(tsc, scriptDir)
    try { assert.deepEqual(leaked, moduleDetection !== "force" ? [] : ["TS2304 Cannot find name 'privateBodyValue'."], "unmarked script/" + moduleDetection) }
    catch (error) { issues.push(error) }
  }
  // JSX tokens in a .ts file are not JSX, whatever the jsx option says.
  for (const jsx of ["preserve", "react-jsx"]) {
    const dir = join(root, "view-ts-" + jsx)
    project(dir, "auto", { "view.ts": "export const element = <div />\n" })
    const config = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8"))
    config.compilerOptions.jsx = jsx
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config))
    for (const compiler of [tsc, vibelang]) {
      try { assert.ok(compile(compiler, dir).some(d => d.startsWith("TS1005 ")), "view.ts/" + jsx) } catch (error) { issues.push(error) }
    }
    rmSync(join(dir, "view.ts"))
    writeFileSync(join(dir, "view.tsx"), "export const element = <div />\n")
    writeFileSync(join(dir, "jsx.d.ts"), "declare global { namespace JSX { interface IntrinsicElements { div: {} } interface Element {} } }\nexport {}\n")
    try { assert.deepEqual(compile(tsc, dir).filter(d => d.startsWith("TS1005 ")), [], "view.tsx/" + jsx) } catch (error) { issues.push(error) }
  }
  if (issues.length) throw new AggregateError(issues, issues.map(e => e.message).join("\n---\n"))
} finally { rmSync(root, { recursive: true, force: true }) }
console.log("module bodies match their sibling TypeScript twins")
