import fs from "node:fs"
import os from "node:os"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const ts = require(path.resolve("docs/tools/node_modules/typescript"))
if (ts.version !== "5.9.3") throw new Error("stock oracle requires TypeScript 5.9.3, got " + ts.version)
const files = new Map(["a.ts", "b.tsx", "e.ts", "e.tsx", "dir/index.tsx", "d.web.tsx"].map(p => ["/repo/" + p, "export const value = 1"]))
const host = {
  fileExists: p => files.has(p),
  readFile: p => files.get(p),
  directoryExists: p => [...files.keys()].some(f => f.startsWith(p.replace(/\/$/, "") + "/")),
  getCurrentDirectory: () => "/repo",
  getDirectories: () => []
}
let cells = 0
for (const mode of [ts.ModuleResolutionKind.Node10, ts.ModuleResolutionKind.NodeNext, ts.ModuleResolutionKind.Bundler]) {
  for (const [stem, expected] of [
    ["a", ["a.ts", "a.ts", "a.ts", "a.ts", "a.ts"]],
    ["b", ["b.tsx", "b.tsx", "b.tsx", "b.tsx", "b.tsx"]],
    ["e", ["e.ts", "e.ts", "e.tsx", "e.ts", "e.tsx"]]
  ]) {
    for (const [i, ext] of ["", ".js", ".jsx", ".ts", ".tsx"].entries()) {
      const options = { moduleResolution: mode, module: ts.ModuleKind.NodeNext, jsx: ts.JsxEmit.React }
      const got = ts.resolveModuleName("./" + stem + ext, "/repo/main.ts", options, host, undefined, undefined, ts.ModuleKind.CommonJS).resolvedModule?.resolvedFileName
      const want = "/repo/" + expected[i]
      if (got !== want) throw new Error(JSON.stringify({ mode, stem, ext, got, want }))
      cells++
    }
  }
}
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, moduleSuffixes: [".web", ""] }
const suffix = ts.resolveModuleName("./d.js", "/repo/main.ts", options, host).resolvedModule?.resolvedFileName
if (suffix !== "/repo/d.web.tsx") throw new Error("stock suffix result: " + suffix)
const dir = ts.resolveModuleName("./dir", "/repo/main.ts", options, host).resolvedModule?.resolvedFileName
if (dir !== "/repo/dir/index.tsx") throw new Error("stock directory result: " + dir)
console.log(`TypeScript ${ts.version}: ${cells + 2} native resolution controls PASS; explicit .ts/.tsx substitute in both directions`)


// Run the actual stock tsc too: every VibeLang source becomes its native twin,
// preserving all sixteen importer/target edges and the Effect main result.
const twin = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-tsc-twin-"))
try {
  const extensions = ["ts", "tsx", "vibe", "vibex"]
  const cases = path.resolve("typescript/vibelang/cases/vibex-imports")
  for (const kind of ["importer", "target"]) {
    for (const extension of extensions) {
      const source = kind + "-" + extension + "." + extension
      const native = source.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")
      fs.writeFileSync(path.join(twin, native), fs.readFileSync(path.join(cases, source)))
    }
  }
  const imports = extensions.map((ext, i) => 'import { values as v' + (i + 1) + ' } from "./importer-' + ext + '.js"').join("\n")
  fs.writeFileSync(path.join(twin, "main.ts"),
    'import { Effect } from "effect"\n' + imports +
    '\nexport function main() { return Effect.gen(function* () { return [v1, v2, v3, v4] }) }\n' +
    'Effect.runPromise(main()).then(value => console.log(JSON.stringify(value)))\n')
  fs.writeFileSync(path.join(twin, "package.json"), '{"type":"module"}\n')
  const config = JSON.parse(fs.readFileSync(path.join(cases, "tsconfig.json"), "utf8"))
  config.include = ["*.ts", "*.tsx"]
  fs.writeFileSync(path.join(twin, "tsconfig.json"), JSON.stringify(config))
  fs.mkdirSync(path.join(twin, "node_modules"))
  fs.symlinkSync(path.resolve(process.env.EFFECT_NODE_MODULES, "effect"), path.join(twin, "node_modules", "effect"))
  const compiler = spawnSync(process.execPath, [path.resolve("docs/tools/node_modules/typescript/bin/tsc"), "-p", twin], { cwd: twin, encoding: "utf8", timeout: 60000 })
  if (compiler.status !== 0) throw new Error("stock tsc twin failed: " + compiler.stdout + compiler.stderr + (compiler.error ?? ""))
  const run = spawnSync(process.execPath, [path.join(twin, "out/main.js")], { cwd: twin, encoding: "utf8", timeout: 60000 })
  const expected = JSON.stringify(Array.from({ length: 4 }, () => [1, 2, 3, 4]))
  if (run.status !== 0 || run.stdout.trim() !== expected) throw new Error("stock twin runtime failed: " + run.stdout + run.stderr)
  console.log("TypeScript " + ts.version + " CLI: all 16 native importer/target pairs compile and return " + expected)
} finally {
  fs.rmSync(twin, { recursive: true, force: true })
}
