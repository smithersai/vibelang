import { expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "snippet-compiler-"))
  const source = join(root, "docs/tools/check-snippets.ts")
  mkdirSync(dirname(source), { recursive: true })
  copyFileSync(new URL("./check-snippets.ts", import.meta.url), source)
  return root
}
const binary = (root: string, path: string) => {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, "")
  return file
}
async function choose(root: string, override?: string) {
  const env = { ...process.env }
  delete env.VIBELANG_BINARY
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

test("docs use the native build, then the legacy build, then PATH", async () => {
  const root = fixture()
  try {
    const native = binary(root, "packages/compiler/native/vibelang" + (process.platform === "win32" ? ".exe" : ""))
    const legacy = binary(root, "typescript/built/local/tsc")
    expect(await choose(root)).toBe(native)
    rmSync(native)
    expect(await choose(root)).toBe(legacy)
    rmSync(legacy)
    expect(await choose(root)).toBe("vibelang")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("an explicit compiler override wins over a checkout build", async () => {
  const root = fixture()
  try {
    binary(root, "packages/compiler/native/vibelang" + (process.platform === "win32" ? ".exe" : ""))
    expect(await choose(root, "/explicit/compiler")).toBe("/explicit/compiler")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
