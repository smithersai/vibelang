import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = process.env.DOCS_REVIEW_ROOT || resolve(import.meta.dir, "../..")
const read = (path: string) => readFileSync(resolve(root, path), "utf8")

test("adjustable diagnostics identify EK9100 as an editor warning", () => {
  const configure = read("docs/user/src/getting-started/012-devtools.md")
    .split("## Configure compiler checks")[1].split("## TypeScript-style Effect code")[0]
  expect(configure).toMatch(/EK9100[^\n]*editor-only[^\n]*warns by default/)
})

import { extract } from "./check-snippets"

test("the HTTP client guide checks a request, JSON body read, and client layer together", () => {
  const blocks = extract(read("docs/user/src/platform/105-introduction.md"))
  // A block waiting for the compiler's VIP forms counts; it compiles once its pending line goes.
  expect(blocks.some(block => (!block.fragment || block.pending) && !block.gap && !block.expected.length &&
    /HttpClient\.get\(/.test(block.source) && /try response\.json\b/.test(block.source) &&
    /provide FetchHttpClient\.layer/.test(block.source))).toBe(true)
})

test("TypeScript-file onboarding enables Node declarations explicitly", () => {
  const page = read("docs/user/src/getting-started/005-creating-effects.md")
  const moduleSection = page.split("## Write TypeScript in a separate file")[1].split("## Suspend work")[0]
  expect(moduleSection).toContain("@types/node")
  expect(moduleSection).toMatch(/"types": \["node"\]/)
  expect(extract(moduleSection).find(block => block.source.includes('from "node:fs"'))?.source).toContain("// types: node")
})

test("process exit replacements clarify status codes beside the compiler-backed table", () => {
  const page = read("docs/user/src/platform/platform-globals.md")
  const note = page.split("A numeric return value")[1]?.split("## The replacements at work")[0] || ""
  expect(note).toMatch(/return 3.*still exits 0/)
  expect(note).toMatch(/Return normally for exit 0,[\s\S]*fail for exit 1,[\s\S]*interrupt for exit 130/)
})

test("the contributor compiler-semantics command installs runtime dependencies first", () => {
  const row = read("CONTRIBUTING.md").split("\n").find(line => line.startsWith("| Compiler semantics |")) || ""
  expect(row).toMatch(/cd packages\/runtime && bun install.*cd typescript && sh vibelang\/smoke\.sh/)
})

test("Bun starter instructions distinguish package manager and Node runtime", () => {
  for (const path of ["README.md", "docs/user/src/setup/new-project.md"]) {
    const page = read(path)
    expect(page).toMatch(/Bun as the package manager[^\n]*app[^\n]*Node/)
    expect(page).toMatch(/\]\([^)]*vibelang-cli(?:\.md)?#run-sources-with-bun\)/)
  }
})

test("the entry module selects the platform by providing its layer (VIP-26, VIP-33)", () => {
  const page = read("docs/user/src/platform/105-introduction.md")
  expect(page).toContain("NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))")
  expect(page).toMatch(/leave platform selection to the entry module/)
})
