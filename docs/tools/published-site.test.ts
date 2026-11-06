import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildMarkdown, currentReleaseNotes, updateFullBundle } from "./markdown"
import fc from "fast-check"
import { builtInstallProblems } from "./published-site.mjs"
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
        for (const [, name, version] of line.matchAll(/(?<![\w/-])((?:@smthrs\/cli-[a-z0-9-]+|(?:create-)?vibelang(?:-(?!typescript@)[a-z0-9-]+)?))@([^\s\x60"\x27<>),;]+)/g)) {
          if (!snapshot.packages[name] || (version !== "latest" && (!(snapshot.packages[name].versions ?? [snapshot.packages[name].version]).includes(version) || (!historical && version !== snapshot.compiler.version)))) problems.push(name + "@" + version)
        }
      }
      if (file.endsWith("/004-installation.md")) {
        for (const name of text.match(/(?:\bvibelang-(?:darwin|linux|win32)|@smthrs\/cli-win32)-(?:arm64|x64)\b/g) ?? []) {
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


test("the full bundle uses the selected release and links to older release history", () => {
  const dir = mkdtempSync(join(tmpdir(), "published-bundle-"))
  const version = "0.0.11"
  const release = {
    ...snapshot,
    compiler: { ...snapshot.compiler, version },
    packages: Object.fromEntries(Object.entries(snapshot.packages).map(([name, manifest]) =>
      [name, { ...manifest, version, versions: ["0.0.9", "0.0.10", version] }])),
  }
  try {
    // Model the aggregate Vocs writes before the Markdown postbuild step.
    const prefix = "# Welcome\n\nOriginal overview.\n\n"
    const suffix = "# VIP-1\n\nOriginal decision text.\n\n\x60\x60\x60md\n# Release notes\n## 0.0.99\n\x60\x60\x60\n"
    writeFileSync(join(dir, "llms-full.txt"), prefix + "# Release notes\n\n## 0.0.11\nCurrent notes.\n\n## 0.0.10\nnpm install vibelang@0.0.10\n\n" + suffix)
    buildMarkdown(dir, { testCount: "123", testFiles: "4", kernelLines: "567" }, release)
    const full = readFileSync(join(dir, "llms-full.txt"), "utf8")
    expect(full).toContain("## " + version)
    expect(full).toContain("https://vibelang.sh/setup/release-notes.md")
    expect(full.startsWith(prefix)).toBe(true)
    expect(full.endsWith(suffix)).toBe(true)
    expect(full).not.toContain("## 0.0.10")
    expect(full).not.toMatch(/(?:install|add)[^\n]*vibelang(?:-runtime|-vite)?@0\.0\.10/)
    const history = readFileSync(join(dir, "setup/release-notes.md"), "utf8")
    expect(history).toContain("## 0.0.10")
    expect(history).toContain("vibelang@0.0.10")
    expect(builtInstallProblems(dir, release)).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test("combined release notes retain current commands across generated release histories", () => {
  fc.assert(fc.property(
    fc.integer({ min: 2, max: 1000 }),
    fc.array(fc.constantFrom("npm install", "pnpm add", "bun add", "yarn add"), { minLength: 1, maxLength: 12 }),
    (patch, commands) => {
      const current = "## 1.0." + patch + "\nnpm install vibelang@1.0." + patch + "\n"
      const history = commands.map((command, i) => "## 0.0." + i + "\n" + command + " vibelang@0.0." + i + "\n").join("\n")
      const result = currentReleaseNotes("# Release notes\n\n" + current + "\n" + history)
      expect(result).toContain(current.trim())
      expect(result).not.toContain("vibelang@0.0.")
      expect(result).toContain("https://vibelang.sh/setup/release-notes.md")
    },
  ), { numRuns: 100 })
})


test("full-bundle rewriting ignores headings in examples and fails closed on missing pages", () => {
  const notes = "# Release notes\n\n## 1.0.2\nCurrent.\n\n\x60\x60\x60md\n## 0.0.99\n\x60\x60\x60\n\n## 1.0.1\nOld.\n"
  const current = currentReleaseNotes(notes)
  expect(current).toContain("## 0.0.99")
  expect(current).not.toContain("## 1.0.1")
  expect(() => updateFullBundle("# VIP-1\nDecision.\n", notes)).toThrow("exactly one")
  expect(() => updateFullBundle("# Release notes\nA.\n# Release notes\nB.\n", notes)).toThrow("exactly one")
})

test("full-bundle rewriting preserves generated surrounding page content exactly", () => {
  fc.assert(fc.property(fc.array(fc.string({ unit: "grapheme", maxLength: 30 }), { maxLength: 10 }), chunks => {
    const text = chunks.map(chunk => JSON.stringify(chunk)).join("\n")
    const prefix = "# Welcome\n\n\x60\x60\x60json\n" + text + "\n\x60\x60\x60\n\n"
    const suffix = "# VIP-1\n\n\x60\x60\x60json\n" + text + "\n\x60\x60\x60\n"
    const bundle = prefix + "# Release notes\n\n## 1.0.2\nCurrent.\n\n## 1.0.1\nOld.\n\n" + suffix
    const result = updateFullBundle(bundle, "# Release notes\n\n## 1.0.2\nCurrent.\n\n## 1.0.1\nOld.\n")
    expect(result.startsWith(prefix)).toBe(true)
    expect(result.endsWith(suffix)).toBe(true)
    expect(result).not.toContain("## 1.0.1")
  }), { numRuns: 100 })
})
