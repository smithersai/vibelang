import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { analyzeGoFile, emit, GO_PACKAGES, ROOT, walkFiles } from "./_lib.ts"

// 1. Exported Go symbol doc-comment coverage per VibeLang Go package
for (const pkg of GO_PACKAGES) {
  const prodGo = walkFiles(join(ROOT, pkg), ".go").filter((f) => !f.endsWith("_test.go"))
  let exported = 0
  let documented = 0
  for (const file of prodGo) {
    const stats = analyzeGoFile(file)
    exported += stats.exportedDecls
    documented += stats.documentedExportedDecls
  }
  if (exported === 0) continue
  const pct = Math.round((documented * 100) / exported)
  emit("go-doc-coverage", pct, {
    item: pkg,
    note: pct < 80 ? `${documented}/${exported} exported Go decls have doc comments` : undefined
  })
}

// 2. Relative Markdown links across top-level docs and design/user docs
const mdFiles = [
  ...["README.md", "AGENTS.md", "CONTRIBUTING.md", "MAINTAINERS.md"].filter((f) => existsSync(join(ROOT, f))),
  ...walkFiles(join(ROOT, "docs/design/src"), ".md"),
  ...walkFiles(join(ROOT, "docs/user/src"), ".md")
]

for (const md of mdFiles) {
  const raw = readFileSync(join(ROOT, md), "utf8")
  // Strip fenced code blocks and inline code spans so code syntax like `[x](value)` is not parsed as a link.
  const content = raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "")
  const links = [...content.matchAll(/\[[^\]]+\]\(([^)#\s]+)(?:#[^)]+)?\)/g)]
  let broken: string | undefined
  for (const match of links) {
    const target = match[1].trim()
    if (!target || /^(https?:|mailto:|#|\/)/.test(target)) continue
    const resolved = resolve(dirname(join(ROOT, md)), target)
    if (!existsSync(resolved)) {
      broken = `broken link target: ${target}`
      break
    }
  }
  emit("markdown-links", broken ? "fail" : "pass", { item: md, note: broken })
}
