import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const effectDir = dirname(fileURLToPath(import.meta.resolve("effect/package.json")))
const effectMetadata = JSON.parse(readFileSync(join(effectDir, "package.json"), "utf8"))

test("the compiler entry shares every core helper with the public package", async () => {
  const publicEntry = await import("../dist/index.js")
  const core = await import("../dist/core.js")
  const guardedCore = await import("../dist/core-entry.js")
  expect(Object.keys(core)).toEqual(Object.keys(publicEntry).filter(name => name !== "Experimental"))
  expect(Object.keys(guardedCore)).toEqual(Object.keys(core))
  for (const name of Object.keys(core) as Array<keyof typeof core>) {
    expect(core[name]).toBe(publicEntry[name])
    expect(guardedCore[name]).toBe(core[name])
  }
})

for (const version of ["4.1.1", "4.1.0", "3.19.0"]) {
  test(`the compiler entry preserves the Node and Bun guard for Effect ${version}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "vibelang-core-entry-"))
    try {
      const runtime = join(dir, "node_modules/vibelang-runtime")
      const effect = join(dir, "node_modules/effect")
      mkdirSync(runtime, { recursive: true })
      mkdirSync(effect, { recursive: true })
      cpSync(join(packageDir, "dist"), join(runtime, "dist"), { recursive: true })
      cpSync(join(packageDir, "package.json"), join(runtime, "package.json"))
      writeFileSync(join(effect, "package.json"), JSON.stringify(version !== "3.19.0"
        ? { ...effectMetadata, version }
        : { name: "effect", version, type: "module", exports: { "./package.json": "./package.json" } }))
      if (version !== "3.19.0") symlinkSync(join(effectDir, "dist"), join(effect, "dist"))
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      writeFileSync(join(dir, "main.js"), 'import { Effect, $bind } from "vibelang-runtime/internal"; console.log(Effect.runSync($bind(42)))\n')
      for (const executable of ["node", process.execPath]) {
        const result = Bun.spawnSync([executable, "main.js"], { cwd: dir, timeout: 10_000 })
        const output = result.stdout.toString() + result.stderr.toString()
        if (version === "4.1.1") {
          expect(result.exitCode).toBe(0)
          expect(output.trim()).toBe("42")
        } else {
          expect(result.exitCode).not.toBe(0)
          expect(output).toContain(`requires effect@4.1.1; found effect@${version}`)
          expect(output).not.toContain("ERR_PACKAGE_PATH_NOT_EXPORTED")
        }
      }
      if (version !== "3.19.0") {
        const bundled = await Bun.build({ entrypoints: [join(dir, "main.js")], target: "browser", format: "esm", minify: true })
        expect(bundled.success).toBe(true)
        writeFileSync(join(dir, "bundle.js"), await bundled.outputs[0].text())
        const result = Bun.spawnSync(["node", "bundle.js"], { cwd: dir, timeout: 10_000 })
        const output = result.stdout.toString() + result.stderr.toString()
        if (version === "4.1.1") {
          expect(result.exitCode).toBe(0)
          expect(output.trim()).toBe("42")
        } else {
          expect(result.exitCode).not.toBe(0)
          expect(output).toContain(`requires effect@4.1.1; found effect@${version}`)
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 30_000)
}
