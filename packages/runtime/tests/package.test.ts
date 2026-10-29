import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const effectDir = dirname(fileURLToPath(import.meta.resolve("effect/package.json")))
const effectMetadata = JSON.parse(readFileSync(join(effectDir, "package.json"), "utf8"))
const fixture = (version: string) => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-runtime-"))
  const runtime = join(dir, "node_modules/vibelang-runtime")
  const effect = join(dir, "node_modules/effect")
  mkdirSync(runtime, { recursive: true })
  mkdirSync(effect, { recursive: true })
  cpSync(join(packageDir, "dist"), join(runtime, "dist"), { recursive: true })
  cpSync(join(packageDir, "package.json"), join(runtime, "package.json"))
  writeFileSync(join(effect, "package.json"), JSON.stringify({ ...effectMetadata, version }))
  symlinkSync(join(effectDir, "dist"), join(effect, "dist"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "main.js"), `import { Effect, $bind } from "vibelang-runtime"; console.log(Effect.runSync($bind(42)))`)
  return dir
}

for (const kernelFirst of [false, true]) {
  test(`package: static runtime and kernel imports (${kernelFirst ? "kernel first" : "runtime first"})`, () => {
    const dir = fixture("4.1.0")
    try {
      const imports = [
        'import { Effect, $bind } from "vibelang-runtime";',
        'import { catchExpected } from "vibelang-runtime/kernel";'
      ]
      if (kernelFirst) imports.reverse()
      writeFileSync(join(dir, "main.js"), imports.join("\n") + '\nconsole.log(Effect.runSync($bind(42)), typeof catchExpected)\n')
      for (const executable of ["node", process.execPath]) {
        const result = Bun.spawnSync([executable, "main.js"], { cwd: dir, timeout: 10_000 })
        expect(result.stderr.toString()).toBe("")
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString().trim()).toBe("42 function")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

for (const version of ["4.1.0", "4.0.7", "4.1.1", "3.99.0"]) {
  test(`package: Node, Bun, and browser bundles check effect@${version}`, async () => {
    const dir = fixture(version)
    try {
      const bundled = await Bun.build({
        entrypoints: [join(dir, "main.js")], target: "browser", format: "esm",
        outdir: join(dir, "bundle"), minify: true
      })
      expect(bundled.success).toBe(true)
      const bundle = await bundled.outputs[0].text()
      expect(bundle).not.toContain("node:module")
      const commands = [
        ["node", "main.js"], [process.execPath, "main.js"], ["node", "bundle/main.js"],
        ["node", "--input-type=commonjs", "-e", 'const { Effect, $bind } = require("vibelang-runtime"); console.log(Effect.runSync($bind(42)))']
      ]
      for (const command of commands) {
        const result = Bun.spawnSync(command, { cwd: dir, stdout: "pipe", stderr: "pipe" })
        const output = result.stdout.toString() + result.stderr.toString()
        if (version === "4.1.0") {
          expect(result.exitCode).toBe(0)
          expect(output.trim()).toBe("42")
        } else {
          expect(result.exitCode).not.toBe(0)
          expect(output).toContain("vibelang-runtime@0.0.11 requires effect@4.1.0")
          expect(output).toContain(`found effect@${version}`)
          expect(output).toContain("npm install effect@4.1.0")
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
}

test("package: the ES-module and CommonJS guards pin the same Effect version", () => {
  const pin = (file: string) => readFileSync(join(packageDir, "src", file), "utf8").match(/PINNED_EFFECT_VERSION = "([0-9.]+)"/)?.[1]
  expect(pin("version.ts")).toBeDefined()
  expect(pin("version-guard.cts")).toBe(pin("version.ts"))
})

test("package: emitted declarations resolve and retain helper types", () => {
  const result = Bun.spawnSync(["bun", "x", "--no-install", "tsc", "-p", "tests/tsconfig.json"], {
    cwd: packageDir, stdout: "pipe", stderr: "pipe"
  })
  expect(result.stdout.toString() + result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
}, 30_000)

test("package: a missing Effect 3 export cannot hide the version mismatch", async () => {
  const dir = fixture("3.19.0")
  try {
    const effect = join(dir, "node_modules/effect")
    const metadata = JSON.parse(readFileSync(join(effect, "package.json"), "utf8"))
    metadata.exports["."] = "./index.js"
    writeFileSync(join(effect, "package.json"), JSON.stringify(metadata))
    // Keep the rest of the installed graph but omit Pull, as Effect 3 does.
    const names = Object.keys(await import("effect")).filter((name) => name !== "Pull")
    writeFileSync(join(effect, "index.js"), "export { " + names.join(", ") + ' } from "./dist/index.js"\n')
    for (const command of [["node", "main.js"], [process.execPath, "main.js"]]) {
      const result = Bun.spawnSync(command, { cwd: dir, stdout: "pipe", stderr: "pipe" })
      const output = result.stdout.toString() + result.stderr.toString()
      expect(result.exitCode).not.toBe(0)
      expect(output).toContain("requires effect@4.1.0; found effect@3.19.0")
      expect(output).toContain("npm install effect@4.1.0")
      expect(output).not.toContain("does not provide an export")
      expect(output).not.toContain("Export named")
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30_000)

test("package: guarded entry preserves every ABI export and its identity", async () => {
  const entry = await import("../dist/entry.js")
  const abi = await import("../dist/index.js")
  expect(Object.keys(entry)).toEqual(Object.keys(abi))
  for (const name of Object.keys(abi) as Array<keyof typeof abi>) {
    expect(entry[name]).toBe(abi[name])
  }
})

test("package: the version check does not resolve an incompatible Effect graph", () => {
  const dir = fixture("3.19.0")
  try {
    const effect = join(dir, "node_modules/effect")
    rmSync(join(effect, "dist"))
    writeFileSync(join(effect, "package.json"), JSON.stringify({
      name: "effect", version: "3.19.0", type: "module",
      exports: { "./package.json": "./package.json" }
    }))
    for (const command of [["node", "main.js"], [process.execPath, "main.js"]]) {
      const result = Bun.spawnSync(command, { cwd: dir, stdout: "pipe", stderr: "pipe" })
      const output = result.stdout.toString() + result.stderr.toString()
      expect(result.exitCode).not.toBe(0)
      expect(output).toContain("requires effect@4.1.0; found effect@3.19.0")
      expect(output).toContain("npm install effect@4.1.0")
      expect(output).not.toContain("ERR_PACKAGE_PATH_NOT_EXPORTED")
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
