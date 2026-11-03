import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { API } from "../../../packages/typescript/src/api/async/api.ts"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
const root = mkdtempSync(join(tmpdir(), "vip30-api-"))
const binary = process.env.VIBELANG_BINARY
const api = new API({ tsserverPath: binary, cwd: root })
try {
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(root, "node_modules/effect"))
  symlinkSync(process.env.VIBELANG_RUNTIME, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "main.vibe"), "service Flags { static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\nexport type Value = typeof Flags.default;\n")
  // Independent native TypeScript API control: the same parse -> createProgram
  // path must retain strictNullChecks/noEmitOnError and skip the actual write.
  writeFileSync(join(root, "native.ts"), "export const n: string = null;")
  const cfg = ts.parseJsonConfigFileContent({ compilerOptions: { strictNullChecks: true, noEmitOnError: true, types: [], outDir: "native-out" }, files: ["native.ts"] }, ts.sys, root)
  const native = ts.createProgram(cfg.fileNames, cfg.options)
  assert.ok(ts.getPreEmitDiagnostics(native).some(d => d.code === 2322))
  assert.equal(native.emit().emitSkipped, true)
  assert.equal(existsSync(join(root, "native-out", "native.js")), false)
  const issues = []
  const check = (stage, assertion) => { try { assertion() } catch (error) { issues.push(new Error(stage + ": " + error.message)) } }
  for (const severity of ["error", "off", "suggestion"]) {
    writeFileSync(join(root, "vibe.config.json"), JSON.stringify({
      compilerOptions: { strict: true, noEmitOnError: true, declaration: true, target: "ES2022", module: "NodeNext", types: [], skipLibCheck: true, outDir: "out-" + severity },
      files: ["main.vibe"], vibe: { effectGlobals: false, effectModules: false, severities: { EK4855: severity } }
    }))
    const config = await api.parseConfigFile(join(root, "vibe.config.json"))
    const program = await api.createProgram(config.fileNames, config.options)
    console.error(JSON.stringify({ stage: "option-transfer", severity, parsedVibe: Object.hasOwn(config.options, "vibelang"), constructedVibe: Object.hasOwn(program.getCompilerOptions(), "vibelang") }))
    try {
      const diagnostics = await program.getSemanticDiagnostics()
      const warning = diagnostics.filter(d => d.code === 4855)
      check("semantic-" + severity, () => assert.equal(warning.length, severity === "off" ? 0 : 1, JSON.stringify({ stage: "semantic", severity, diagnostics })))
      if (severity !== "off" && warning.length) check("category-" + severity, () => assert.equal(warning[0].category, severity === "error" ? 1 : 2, JSON.stringify({ severity, warning })))
      const output = await program.emit()
      check("emit-" + severity, () => assert.equal(output.emitSkipped, severity === "error", JSON.stringify({ stage: "emit", severity, output })))
      check("file-" + severity, () => assert.equal(existsSync(join(root, "out-" + severity, "main.js")), severity !== "error"))
    } finally { await program.dispose() }
  }


  // A module name discriminates the switch, unlike the historical succeed
  // probe. Native strictNullChecks independently crosses the same API boundary.
  writeFileSync(join(root, "modules.vibe"), "export const value = Option.none();")
  writeFileSync(join(root, "strict.ts"), "export const value: string = null;")
  for (const enabled of [false, true]) {
    for (const mode of ["modules", "native"]) {
      const configPath = join(root, mode + "-" + enabled + ".json")
      writeFileSync(configPath, JSON.stringify({
        compilerOptions: { noEmit: true, strictNullChecks: enabled, types: [], skipLibCheck: true, target: "ES2022", module: "NodeNext" },
        files: [mode === "modules" ? "modules.vibe" : "strict.ts"],
        vibe: { effectModules: enabled }
      }))
      const parsed = await api.parseConfigFile(configPath)
      const program = await api.createProgram(parsed.fileNames, parsed.options)
      try {
        const codes = (await program.getSemanticDiagnostics()).filter(d => d.category === 1).map(d => d.code)
        const expected = mode === "modules" ? enabled ? [] : [2304] : enabled ? [2322] : []
        check(mode + "-" + enabled, () => assert.deepEqual(codes, expected))
      } finally { await program.dispose() }
    }
  }
  writeFileSync(join(root, "migration.vibe"), 'import { Effect } from "effect"; export effect function nested(program: Effect.Effect<number>) { try Effect.succeed(1); return program }')
  const migrationPath = join(root, "migration.json")
  writeFileSync(migrationPath, JSON.stringify({
    compilerOptions: { strict: true, noEmitOnError: true, declaration: true, types: [], skipLibCheck: true, target: "ES2022", module: "NodeNext", outDir: "migration-out" },
    files: ["migration.vibe"], vibe: { severities: { EK4802: "error" } }
  }))
  const migrationConfig = await api.parseConfigFile(migrationPath)
  const migration = await api.createProgram(migrationConfig.fileNames, migrationConfig.options)
  try {
    check("migration-category", () => assert.equal((migration.getCompilerOptions().vibelang?.severities ?? {}).EK4802, "error"))
    const codes = await migration.getSemanticDiagnostics()
    check("migration-warning", () => assert.ok(codes.some(d => d.code === 4802 && d.category === 1), JSON.stringify(codes)))
    const emitted = await migration.emit()
    check("migration-emit", () => assert.equal(emitted.emitSkipped, true))
    check("migration-write", () => assert.equal(existsSync(join(root, "migration-out/migration.js")), false))
  } finally { await migration.dispose() }

  if (issues.length) throw new AggregateError(issues, "VIP-30 parsed API option matrix")
} finally { await api.close(); rmSync(root, { recursive: true, force: true }) }
console.log("compiler API preserves validated config")
