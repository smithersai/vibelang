import assert from "node:assert/strict"
import { writeFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Compare the public program types with stock TypeScript after both emitters
// have produced declarations. Runtime runners separately compare complete Exits.
export function assertProgramTypes(caseUrl, tsc, reference = "reference") {
  const file = fileURLToPath(new URL(`.coverage-types-${process.pid}.ts`, caseUrl))
  const source = `import type { main as vibe } from "./out/main.js"
import type { main as native } from "./${reference}/out/main.js"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export const parameters: Equal<Parameters<typeof vibe>, Parameters<typeof native>> = true
export const result: Equal<ReturnType<typeof vibe>, ReturnType<typeof native>> = true
`
  try {
    writeFileSync(file, source, { flag: "wx" })
    const checked = spawnSync(process.execPath, [tsc, "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", file], { encoding: "utf8", timeout: 60000 })
    assert.equal(checked.error, undefined)
    assert.equal(checked.status, 0, "program types differ: " + checked.stdout + checked.stderr)
  } finally {
    rmSync(file, { force: true })
  }
}
