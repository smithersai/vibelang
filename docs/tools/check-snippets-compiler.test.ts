import { expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "snippet-compiler-"))
  const source = join(root, "docs/tools/check-snippets.ts")
  mkdirSync(dirname(source), { recursive: true })
  copyFileSync(process.env.VIBELANG_SNIPPETS_ROOT ? join(process.env.VIBELANG_SNIPPETS_ROOT, "docs/tools/check-snippets.ts") : new URL("./check-snippets.ts", import.meta.url), source)
  return root
}
const binary = (root: string, path: string) => {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, "#!/bin/sh\necho fixture\n", { mode: 0o755 })
  return file
}
async function choose(root: string, override?: string, path?: string) {
  const env = { ...process.env }
  delete env.VIBELANG_BINARY
  if (path !== undefined) env.PATH = path + delimiter + env.PATH
  if (override !== undefined) env.VIBELANG_BINARY = override
  const child = Bun.spawn(["bun", "-e",
    `const { defaultCompiler } = await import(${JSON.stringify(join(root, "docs/tools/check-snippets.ts"))}); console.log(defaultCompiler())`],
    { cwd: root, env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ])
  expect({ status, stderr }).toEqual({ status: 0, stderr: "" })
  return stdout.trim()
}

test("docs use checkout builds and never fall back to PATH", async () => {
  const root = fixture()
  try {
    const native = binary(root, "packages/compiler/native/vibelang" + (process.platform === "win32" ? ".exe" : ""))
    const legacy = binary(root, "typescript/built/local/tsc")
    expect(await choose(root)).toBe(native)
    rmSync(native)
    expect(await choose(root)).toBe(legacy)
    rmSync(legacy)
    expect(await choose(root)).toBe(native)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("an explicit compiler override wins over a checkout build", async () => {
  const root = fixture()
  try {
    binary(root, "packages/compiler/native/vibelang" + (process.platform === "win32" ? ".exe" : ""))
    expect(await choose(root, "/explicit/compiler")).toBe("/explicit/compiler")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const mode of ["missing", "native", "legacy", "override"]) {
  test("an installed PATH compiler cannot replace the selected doc compiler: " + mode, async () => {
    const root = fixture()
    try {
      const path = join(root, "bin")
      binary(root, "bin/vibelang")
      const native = join(root, "packages/compiler/native/vibelang" + (process.platform === "win32" ? ".exe" : ""))
      const legacy = join(root, "typescript/built/local/tsc")
      if (mode === "native") binary(root, "packages/compiler/native/vibelang" + (process.platform === "win32" ? ".exe" : ""))
      if (mode === "legacy") binary(root, "typescript/built/local/tsc")
      const override = mode === "override" ? "/explicit/release" : undefined
      expect(await choose(root, override, path)).toBe(override || (mode === "legacy" ? legacy : native))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}
