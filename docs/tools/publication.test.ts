import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { leaks } from "./leaks"
import { buildMarkdown } from "./markdown"
import { publicationText } from "../../site/scripts/publication.mjs"

test("publication keeps refusals after normalizing known build metadata", () => {
  const normalized = publicationText('{"id":"/build/site/src/pages/setup.mdx#install","example":"/home/user/report.pdf"}', "/build/site")
  expect(normalized).toContain("./src/pages/setup.mdx#install")
  expect(normalized).toContain("/example/user/report.pdf")
  expect(leaks(publicationText('["192.168.1.42", "10.0.0.134"]', "/build/site"))).toEqual([])
  expect(leaks("/home/other/private.txt").length).toBeGreaterThan(0)
  for (const address of ["10.0.0.1", "10.255.255.255", "192.168.1.1"]) expect(leaks(address).length).toBeGreaterThan(0)
  expect(leaks(publicationText("M-.232-2.718 10.059.003.23-2.622", "/build/site"))).toEqual([])
})

test("prepare-site rejects unexpected paths, hosts and credential values", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-publication-"))
  try {
    for (const text of ["/home/other/file", "private-build.example", "192.168.1.2", "fixture-sensitive-value-0123456789"]) {
      writeFileSync(join(dir, "test.html"), text)
      const result = Bun.spawnSync(["bun", join(import.meta.dir, "prepare-site.ts"), dir], {
        env: { ...process.env, VIBELANG_LEAK_PATTERNS: JSON.stringify(["private-build\\.example"]), PUBLICATION_TEST_SECRET: "fixture-sensitive-value-0123456789" },
        stdout: "pipe", stderr: "pipe"
      })
      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).not.toContain("fixture-sensitive-value-0123456789")
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("Markdown module preserves visible code, strips repository targets and moves cross-chapter fragments", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-markdown-"))
  try {
    buildMarkdown(dir, { testCount: "123", testFiles: "4", kernelLines: "567" })
    const repo = resolve(import.meta.dir, "../..")
    const source = readFileSync(join(repo, "docs/user/src/001-onboarding.md"), "utf8")
    const copy = readFileSync(join(dir, "001-onboarding.md"), "utf8")
    for (const match of source.matchAll(/^\x60{3}[^\n]*\n[\s\S]*?^\x60{3}/gm)) expect(copy).toContain(match[0].replace(/^\s*\/\/\s*(?:run|pending):.*\n/gm, ""))
    const appendix = readFileSync(join(dir, "spec/900-appendices.md"), "utf8")
    expect(appendix).not.toContain("{{testCount}}")
    expect(appendix).not.toMatch(/\]\([^)]*\.\.\//)
    const chapters = readFileSync(join(dir, "spec/000-intro.md"), "utf8")
    expect(chapters).toContain("https://vibelang.sh/spec/")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
