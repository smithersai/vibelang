import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { command, defaultCompiler, extract, linkModules, writeProject } from "./check-snippets"

test("the experimental namespace documents pure modules without a service requirement", () => {
  const source = readFileSync(new URL("../../packages/runtime/src/experimental/index.ts", import.meta.url), "utf8")
  const description = source.slice(0, source.indexOf("*/")).replace(/\s*\*\s*/g, " ")
  expect(description).toContain("service or pure capability")
  expect(description).toContain("Pure modules need no service key or layer.")
  expect(description).not.toContain("pure Encoding")
})

test("the experimental API guide's summary tables cover the runtime exports", () => {
  const guide = readFileSync(new URL("../user/src/vibelang-features/118-experimental-platform-apis.md", import.meta.url), "utf8")
  const summary = guide.split("\n## Encoding")[0]
  const exportNames = (path: string) => {
    const text = readFileSync(new URL("../../packages/runtime/src/experimental/" + path, import.meta.url), "utf8")
    return [...text.matchAll(/^export \* as (\w+) from/gm)].map(([, name]) => name)
  }
  const modules = summary.slice(summary.indexOf("| Module |"), summary.indexOf("\n## How they work"))
  for (const name of exportNames("index.ts")) expect(modules).toContain(`\`Experimental.${name}\``)
  for (const platform of ["node", "bun", "browser", "worker"]) {
    const row = summary.split("\n").find(line => line.startsWith(`| \`vibelang-runtime/experimental/platform-${platform}\` |`))
    for (const name of exportNames(`platform-${platform}/index.ts`)) expect(row).toContain(`\`${name}.layer\``)
  }
})

test.skipIf(!existsSync(defaultCompiler()))("the conformance example emits a public declaration", async () => {
  const guide = readFileSync(new URL("../user/src/vibelang-features/118-experimental-platform-apis.md", import.meta.url), "utf8")
  const block = extract(guide).find(block => block.source.includes("export effect function certify("))
  if (!block) throw new Error("missing conformance example")
  const root = mkdtempSync(join(tmpdir(), "docs-conformance-"))
  const dir = join(root, "project")
  try {
    const { filenames } = writeProject(dir, [block])
    linkModules(dir)
    const result = await command([defaultCompiler(), "-p", "tsconfig.json", "--noEmit", "false",
      "--declaration", "--emitDeclarationOnly"], dir, 20_000)
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
    const declaration = readFileSync(join(dir, filenames.get(block.number)!.replace(/\.vibe$/, ".d.ts")), "utf8")
    expect(declaration).toContain("from \"vibelang-runtime/experimental/Test\"")
    expect(declaration).not.toContain("experimental/internal")
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
