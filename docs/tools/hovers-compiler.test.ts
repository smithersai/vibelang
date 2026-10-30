import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const native = resolve(import.meta.dir, "../../packages/compiler/native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
const legacy = resolve(import.meta.dir, "../../typescript/built/local/tsc")
const selected = process.env.VIBELANG_BINARY || (existsSync(native) ? native : legacy)
const compiler = Bun.which(selected) ?? resolve(selected)
const cacheTest = "a second run reuses the page's entry"

for (const mode of ["override", "native", "legacy"]) {
  test.skipIf(!existsSync(compiler))("hover-cache checks discover the selected compiler: " + mode, () => {
    const root = mkdtempSync(join(tmpdir(), "vibelang-hover-compiler-"))
    try {
      const dir = join(root, "docs/tools")
      mkdirSync(dir, { recursive: true })
      const source = readFileSync(join(import.meta.dir, "hovers.test.ts"), "utf8")
        .replace('from "./hovers"', "from " + JSON.stringify(join(import.meta.dir, "hovers.ts")))
        .replace('from "./leaks"', "from " + JSON.stringify(join(import.meta.dir, "leaks.ts")))
      const file = join(dir, "hovers.test.ts")
      writeFileSync(file, source)
      const env = { ...process.env }
      delete env.VIBELANG_BINARY
      if (mode === "override") env.VIBELANG_BINARY = compiler
      else {
        const artifact = mode === "native"
          ? join(root, "packages/compiler/native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
          : join(root, "typescript/built/local/tsc")
        mkdirSync(dirname(artifact), { recursive: true })
        symlinkSync(compiler, artifact, "file")
      }
      const result = Bun.spawnSync([process.execPath, "test", "-t", "^" + cacheTest + "$", file], {
        env, stdout: "pipe", stderr: "pipe"
      })
      const output = (result.stdout.toString() + result.stderr.toString()).replace(/\x1b\[[0-9;]*m/g, "")
      expect(result.exitCode, output).toBe(0)
      expect(output).toContain("(pass) " + cacheTest)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 60_000)
}
