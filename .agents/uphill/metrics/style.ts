import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { analyzeGoFile, emit, GO_PACKAGES, NPM_PACKAGES, ROOT, walkFiles } from "./_lib.ts"

// 1. gofmt check & max Go function length per VibeLang Go package
for (const pkg of GO_PACKAGES) {
  const fmt = spawnSync("gofmt", ["-l", pkg], { cwd: ROOT, encoding: "utf8" })
  const badFiles = (fmt.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  emit("go-fmt", badFiles.length === 0 ? "pass" : "fail", {
    item: pkg,
    note: badFiles.length === 0 ? undefined : `Run \`gofmt -w ${badFiles[0]}\` (${badFiles.length} file(s))`
  })

  const prodGo = walkFiles(join(ROOT, pkg), ".go").filter((f) => !f.endsWith("_test.go"))
  if (prodGo.length === 0) continue
  let worst = { file: prodGo[0], name: "none", startLine: 1, lines: 1 }
  for (const file of prodGo) {
    const stats = analyzeGoFile(file)
    if (stats.longestFn.lines > worst.lines) worst = stats.longestFn
  }
  emit("go-max-fn-lines", worst.lines, {
    item: pkg,
    note: worst.lines > 70 ? `${worst.file}:${worst.startLine} ${worst.name} (${worst.lines} lines)` : undefined
  })
}

// 2. TypeScript discipline across npm packages (no explicit `any`, no @ts-ignore/@ts-expect-error)
for (const pkg of NPM_PACKAGES) {
  const tsFiles = walkFiles(join(ROOT, pkg), [".ts", ".tsx"]).filter(
    (f) => !f.endsWith(".d.ts") && !f.includes(".test.") && !f.includes("/test/") && !f.includes("/tests/")
  )
  if (tsFiles.length === 0) continue

  let anyHit: string | undefined
  let ignoreHit: string | undefined

  for (const file of tsFiles) {
    const lines = readFileSync(join(ROOT, file), "utf8").split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (!ignoreHit && /@ts-(?:ignore|expect-error|nocheck)\b/.test(line)) {
        ignoreHit = `${file}:${i + 1}: ${trimmed.slice(0, 80)}`
      }
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue
      const code = line.replace(/\/\/.*$/, "")
      if (!anyHit && /(?:[:<]\s*any\b|\bas\s+any\b)/.test(code)) {
        anyHit = `${file}:${i + 1}: explicit \`any\` type`
      }
    }
  }

  emit("ts-no-explicit-any", anyHit ? "fail" : "pass", { item: pkg, note: anyHit })
  emit("ts-no-ts-ignore", ignoreHit ? "fail" : "pass", { item: pkg, note: ignoreHit })
}
