import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { emitDeclarations, recordDeclarationSurface, compareDeclarations } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"

const ts = createRequire(join(process.cwd(), "packages/runtime/package.json"))("typescript")
const [compiler, key, rawMode] = process.argv.slice(2)
const mode = Number(rawMode) & 15
const fixture = JSON.parse(readFileSync(new URL("../corpus/t3code-saved-native-sibling.json", import.meta.url), "utf8"))
mkdirSync(".cache", { recursive: true })
const root = mkdtempSync(join(process.cwd(), ".cache/saved-native-sibling-"))
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const authored = new Map()
const source = (file, text) => { const bytes = mode & 1 ? text.replaceAll("\n", "\r\n") : text; put(file, bytes); authored.set(file, bytes) }
const native = key !== "outside-inferred-typescript"
const suffix = native ? mode & 4 ? ".vibex" : ".vibe" : ".ts"
const deep = Boolean(mode & 8)
const layoutKey = "layout:" + key + ":" + suffix.slice(1) + ":" + (deep ? "deep" : "shallow")

async function emit(side) {
  const base = join(root, side)
  const pkg = join(base, deep ? "apps/team/server" : "apps/server")
  const internal = ["inside-inferred-native", "missing-native", "changed-type"].includes(key)
  const directory = internal ? pkg : join(base, "scripts/lib")
  for (const dir of [base, pkg, join(base, "scripts")]) source(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }))
  const model = join(directory, "model" + suffix)
  source(model, (mode & 2 ? "/** Preserved model. */\n" : "") + fixture.model)
  const changed = side === "after" && key === "changed-type"
  let helper = fixture.helper.replaceAll(".vibe", suffix)
  if (changed) helper = helper.replace("Box<number>", "Box<string>").replace("value: 1", 'value: "changed"')
  source(join(directory, "helper.ts"), helper)
  let entry = relative(pkg, join(directory, "helper.ts")).replaceAll("\\", "/")
  if (!entry.startsWith(".")) entry = "./" + entry
  source(join(pkg, "vite.config.ts"), fixture.entry.replace("../../scripts/lib/helper.ts", entry))
  const config = {
    compilerOptions: {
      target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      types: [], skipLibCheck: true, allowImportingTsExtensions: true,
      allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true
    },
    vibe: { effectModules: false },
    include: internal ? ["*.ts", "*.vibe", "*.vibex"] : ["vite.config.ts", relative(pkg, directory).replaceAll("\\", "/")]
  }
  if (suffix === ".vibex") config.compilerOptions.jsx = "preserve"
  if (key === "outside-explicit-native") config.compilerOptions.rootDir = deep ? "../../.." : "../.."
  source(join(pkg, "tsconfig.json"), JSON.stringify(config))
  const checked = spawnSync(compiler, ["--singleThreaded", "--noEmit", "--pretty", "false", "-p", "tsconfig.json"], { cwd: pkg, encoding: "utf8", timeout: 60000 })
  assert.equal(checked.status, 0, JSON.stringify({ stage: "native-no-emit", key, mode, status: checked.status, output: checked.stdout, error: checked.stderr }))
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, pkg)
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
  const stock = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => d.code)
  assert.deepEqual(stock, [], JSON.stringify({ stage: "stock-no-emit", key, mode, stock }))
  const out = join(base, "dts")
  const emitted = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: pkg, outDir: out, log: join(base, "emit.log"), root: base, typescript: ts })
  // The inferred multi-root native emission reports TS5011 in the source
  // witness. Preserve that diagnostic; this oracle checks saved-source
  // reconstruction, not a waiver of the compiler's emission requirements.
  const emitCodes = emitted.diagnostics.map(d => String(d.code).replace(/^TS/, ""))
  assert.ok(emitCodes.every(code => code === "5011"), JSON.stringify({ stage: "emit", key, mode, code: emitted.code, emitCodes }))
  if (key === "missing-native" && side === "after") {
    rmSync(model)
    rmSync(join(directory, "model.d" + suffix + ".ts"), { force: true })
    const removeModel = dir => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, item.name)
        if (item.isDirectory()) removeModel(file)
        else if (/^model\.d\.(?:ts|vibe\.ts|vibex\.ts)$/.test(item.name)) rmSync(file)
      }
    }
    removeModel(out)
    authored.delete(model)
  }
  recordDeclarationSurface(ts, out, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }], undefined, { emitDiagnostics: emitted.diagnostics, emitRoot: base })
  return { out, emitCode: emitted.code, emitCodes, emitted: emitted.files }
}

try {
  const before = await emit("before")
  const after = await emit("after")
  const hashes = () => [...authored].map(([file]) => [relative(root, file), createHash("sha256").update(readFileSync(file)).digest("hex")])
  const original = JSON.stringify(hashes())
  const expected = JSON.stringify([...authored].map(([file, text]) => [relative(root, file), createHash("sha256").update(text).digest("hex")]))
  assert.equal(original, expected, "native checking or emission changed an authored input")
  const comparison = compareDeclarations(ts, before.out, after.out, { canonical: true, includePrivate: true })
  const complete = comparison.comparisonComplete
  const identical = comparison.identical
  const missing = key === "missing-native"
  const changed = key === "changed-type"
  const ok = complete === !missing && identical === (!missing && !changed)
  const environment = comparison.environmentDiagnostics ?? []
  const text = JSON.stringify(environment)
  const knownGap = !ok && key === "outside-inferred-native" && !complete &&
    /(?:TS2307|"code":2307)/.test(text) && text.includes("model") &&
    !(comparison.nameDifferences?.length) && !(comparison.typeDifferences?.length)
  console.log(JSON.stringify({
    key: layoutKey, mode, ok, knownGap,
    unchanged: original === JSON.stringify(hashes()),
    nativeNoEmit: 0, stockNoEmit: 0,
    beforeEmit: before, afterEmit: after,
    complete, identical, reason: comparison.incompleteReason ?? null,
    names: comparison.nameDifferences, types: comparison.typeDifferences,
    environment
  }))
} finally {
  rmSync(root, { recursive: true, force: true })
}
