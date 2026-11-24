import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const [file, startedAt] = process.argv.slice(2)
let result
try {
  result = JSON.parse(readFileSync(file, "utf8"))
} catch (error) {
  if (!(error instanceof SyntaxError)) throw error
}
if (Array.isArray(result?.results)) {
  const scratch = mkdtempSync(join(dirname(file), ".ci-results-"))
  const pending = join(scratch, "results.json")
  try {
    writeFileSync(pending, JSON.stringify({ ...result, startedAt }, null, 2) + "\n", { mode: statSync(file).mode })
    renameSync(pending, file)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
