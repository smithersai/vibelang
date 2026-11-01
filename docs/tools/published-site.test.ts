import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildMarkdown } from "./markdown"
import snapshot from "./testdata/npm-0.0.10.json"

test("built install commands and native packages resolve in the npm snapshot, ahead of the compiler manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "published-site-"))
  try {
    buildMarkdown(dir, { testCount: "123", testFiles: "4", kernelLines: "567" }, snapshot)
    const files = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? files(join(path, e.name)) : e.name.endsWith(".md") ? [join(path, e.name)] : [])
    const problems: string[] = []
    for (const file of files(dir)) {
      let text = readFileSync(file, "utf8")
      const historical = /\/(?:spec|vips)\/|(?:release-notes|compiler-gaps)\.md$/.test(file)
      for (const line of text.split("\n")) {
        if (!/\b(?:npm|pnpm|bun|yarn)\s+(?:add|install|i)\b/.test(line)) continue
        for (const [, name, version] of line.matchAll(/(?<![\w/-])((?:@vibelang\/cli-[a-z0-9-]+|(?:create-)?vibelang(?:-[a-z0-9-]+)?))@([^\s\x60"\x27<>),;]+)/g)) {
          if (!snapshot.packages[name] || (version !== "latest" && (!(snapshot.packages[name].versions ?? [snapshot.packages[name].version]).includes(version) || (!historical && version !== snapshot.compiler.version)))) problems.push(name + "@" + version)
        }
      }
      if (file.endsWith("/004-installation.md")) {
        for (const name of text.match(/(?:\bvibelang-(?:darwin|linux|win32)|@vibelang\/cli-win32)-(?:arm64|x64)\b/g) ?? []) {
          if (!snapshot.packages[name]) problems.push(name)
        }
        expect(text).toContain("WSL")
        expect(text).toContain("effect@4.0.6")
      }
    }
    expect(problems).toEqual([])
    const notes = readFileSync(join(dir, "setup/release-notes.md"), "utf8")
    expect(notes).not.toContain("## 0.0.11")
    expect(notes).toContain("## 0.0.10")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
