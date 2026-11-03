import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { typedProgram } from "../../eslint.mjs"

test("typed lint reads vibex sidecars through source, JS and JSX imports", t => {
  const root = mkdtempSync(join(tmpdir(), "vibex-typed-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  symlinkSync(new URL("./node_modules", import.meta.url).pathname, join(root, "node_modules"))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, jsx: "preserve", skipLibCheck: true, allowArbitraryExtensions: true },
    vibe: { effectModules: false }, include: ["*.ts", "*.vibex"]
  }))
  for (const name of ["View", "Other", "Preserved"]) writeFileSync(join(root, name + ".vibex"), 'export interface Props { label: string }\nexport const value = "ok"\n')
  writeFileSync(join(root, "entry.ts"), [
    'import { type Props, value } from "./View.vibex";',
    'import { value as other } from "./Other.js";',
    'import { value as preserved } from "./Preserved.jsx";',
    'const good: Props = { label: value + other + preserved };',
    'const bad: Props = { label: 123 };'
  ].join("\n"))
  const program = typedProgram({ project: "tsconfig.json", tsconfigRootDir: root })
  const entry = program.getSourceFile(join(root, "entry.ts"))
  const diagnostics = program.getSemanticDiagnostics(entry)
  assert.deepEqual(diagnostics.map(d => d.code), [2322], diagnostics.map(d => d.messageText).join("\n"))
  for (const name of ["View", "Other", "Preserved"]) assert.ok(program.getSourceFile(join(root, name + ".d.vibex.ts")), name)
})
