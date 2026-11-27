import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { analyzeGoFile, emit, fileBytes, formatBytes, GO_PACKAGES, NPM_PACKAGES, ROOT, walkFiles } from "./_lib.ts"

for (const pkg of GO_PACKAGES) {
  const goFiles = walkFiles(join(ROOT, pkg), ".go").filter((f) => !f.endsWith("_test.go"))
  if (goFiles.length === 0) continue
  let totalLines = 0
  let maxFileLines = 0
  let maxFileName = ""
  for (const file of goFiles) {
    const stats = analyzeGoFile(file)
    totalLines += stats.lines
    if (stats.lines > maxFileLines) {
      maxFileLines = stats.lines
      maxFileName = file
    }
  }
  emit("go-pkg-prod-lines", totalLines, { item: pkg })
  emit("go-file-max-lines", maxFileLines, {
    item: pkg,
    note: maxFileLines > 500 ? `${maxFileName} (${maxFileLines} lines)` : undefined
  })
}

for (const pkg of NPM_PACKAGES) {
  const files = walkFiles(join(ROOT, pkg), [".ts", ".tsx", ".mjs", ".js"]).filter(
    (f) => !f.includes(".test.") && !f.includes("/test/") && !f.includes("/tests/")
  )
  let bytes = 0
  for (const file of files) bytes += fileBytes(file)
  emit("pkg-source-bytes", formatBytes(bytes), { item: pkg })
}

// Packaged agent skill footprint (loaded into agent context on every .vibe task)
const skillPath = "packages/compiler/skills/vibelang/SKILL.md"
if (existsSync(join(ROOT, skillPath))) {
  emit("skill-bytes", formatBytes(fileBytes(skillPath)))
}

// Tripwire: compiler acceptance cases count
const casesDir = join(ROOT, "typescript/vibelang/cases")
if (existsSync(casesDir)) {
  const caseCount = readdirSync(casesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
  emit("compiler-cases", caseCount)
}
