// run-seconds: 180
import assert from "node:assert/strict"
import { assertReferenceTypes } from "../../test/cov-ch004-twin.mjs"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

const source = readFileSync(new URL("./main.vibe", import.meta.url), "utf8")
const dir = mkdtempSync(join(tmpdir(), "declaration-throws-"))
try {
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, strict: true, types: [], declaration: true, emitDeclarationOnly: true, outDir: join(dir, "stock") }
  writeFileSync(join(dir, "main.ts"), source)
  const program = ts.createProgram([join(dir, "main.ts")], options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: x=>x, getCurrentDirectory: ()=>dir, getNewLine: ()=>"\n" }))
  assert.equal(program.emit().emitSkipped, false)
  writeFileSync(join(dir, "main.vibe"), source)
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], declaration: true, emitDeclarationOnly: true, outDir: "out" }, files: ["main.vibe"], vibe: { effectModules: false, effectGlobals: false } }))
  const result = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assertReferenceTypes(ts, dir, undefined, { before: "stock/main.d.ts", after: "out/main.d.ts" })
  assertReferenceTypes(ts, dir, undefined, { before: "stock/main.d.ts", after: "main.d.vibe.ts" })
  console.log("declaration contracts match TypeScript " + ts.version)
} finally { rmSync(dir, { recursive: true, force: true }) }
