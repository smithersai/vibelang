import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

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

const acceptedInternal = new Set(["4.1.0", "4.1.1", "4.1.4", "4.1.6", "4.2.0"])
for (const version of ["4.1.6", "4.1.1", "4.2.0", "4.0.6", "4.1.6-next.1", "3.19.0"]) {
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
        if (acceptedInternal.has(version)) {
          expect(result.exitCode).toBe(0)
          expect(output.trim()).toBe("42")
        } else {
          expect(result.exitCode).not.toBe(0)
          expect(output).toContain(`requires effect@^4.1.0 (tested on 4.1.6); found effect@${version}`)
          expect(output).not.toContain("ERR_PACKAGE_PATH_NOT_EXPORTED")
        }
      }
      if (version !== "3.19.0") {
        const bundled = await Bun.build({ entrypoints: [join(dir, "main.js")], target: "browser", format: "esm", minify: true })
        expect(bundled.success).toBe(true)
        writeFileSync(join(dir, "bundle.js"), await bundled.outputs[0].text())
        const result = Bun.spawnSync(["node", "bundle.js"], { cwd: dir, timeout: 10_000 })
        const output = result.stdout.toString() + result.stderr.toString()
        if (acceptedInternal.has(version)) {
          expect(result.exitCode).toBe(0)
          expect(output.trim()).toBe("42")
        } else {
          expect(result.exitCode).not.toBe(0)
          expect(output).toContain(`requires effect@^4.1.0 (tested on 4.1.6); found effect@${version}`)
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 30_000)
}

test("vibelang-runtime/core shares every core helper without Experimental or static experimental imports", async () => {
  const coreEntry = await import("vibelang-runtime/core")
  const internalEntry = await import("vibelang-runtime/internal")
  expect(Object.keys(coreEntry)).toEqual(Object.keys(internalEntry))
  expect("Experimental" in coreEntry).toBe(false)
  for (const name of Object.keys(coreEntry) as Array<keyof typeof coreEntry>) {
    expect(coreEntry[name]).toBe(internalEntry[name])
  }

  // Walk every static ESM import reachable from dist/core.js; none may reach experimental/.
  const visited = new Set<string>()
  const queue = [join(packageDir, "dist/core.js")]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^"'\n]+?\s+from\s+)?["'](\.[^"']+)["']/g)) {
      const specifier = match[1]!
      expect(specifier.includes("/experimental/") || specifier.startsWith("./experimental")).toBe(false)
      const resolved = join(dirname(file), specifier)
      if (resolved.endsWith(".js") && !visited.has(resolved)) queue.push(resolved)
    }
  }
})

test("core and root browser bundles tree-shake experimental and kernel modules and stay under 40 kB gzipped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-core-bundle-"))
  try {
    mkdirSync(join(dir, "node_modules"), { recursive: true })
    symlinkSync(packageDir, join(dir, "node_modules/vibelang-runtime"))
    symlinkSync(effectDir, join(dir, "node_modules/effect"))
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')

    const scenarios = [
      {
        name: "compiled-core",
        code: 'import * as Effect from "effect/Effect"; import { $bind, $try, $region } from "vibelang-runtime/core"; console.log(Effect.runSync($try($bind(42))));\n',
        maxGzBytes: 20 * 1024,
        external: [] as Array<string>
      },
      {
        name: "compiled-root",
        code: 'import * as Effect from "effect/Effect"; import { $bind, $try, $region } from "vibelang-runtime"; console.log(Effect.runSync($try($bind(42))));\n',
        maxGzBytes: 20 * 1024,
        external: [] as Array<string>
      },
      {
        name: "prelude-root",
        code: 'import { Effect, $bind } from "vibelang-runtime"; console.log(Effect.runSync($bind(42)));\n',
        maxGzBytes: 40 * 1024,
        external: [] as Array<string>
      },
      {
        name: "core-external-effect",
        code: 'import { $bind } from "vibelang-runtime/core"; export const x = $bind(42);\n',
        maxGzBytes: 4 * 1024,
        external: ["effect", "effect/*"]
      }
    ]

    for (const scenario of scenarios) {
      const entry = join(dir, `${scenario.name}.js`)
      writeFileSync(entry, scenario.code)
      const bundled = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        format: "esm",
        minify: true,
        external: scenario.external,
        metafile: true
      })
      expect(bundled.success).toBe(true)
      const text = await bundled.outputs[0].text()
      const gz = gzipSync(text).byteLength
      const inputs = Object.keys(bundled.metafile?.inputs ?? {})
      expect(inputs.filter((p) => p.includes("/experimental/"))).toEqual([])
      expect(inputs.filter((p) => p.includes("/kernel/"))).toEqual([])
      expect(inputs.filter((p) => p.endsWith("/dist/match.js") || p.endsWith("/dist/fastcalls.js"))).toEqual([])
      expect(gz).toBeLessThan(scenario.maxGzBytes)

      if (scenario.external.length === 0) {
        const outFile = join(dir, `${scenario.name}.bundle.js`)
        writeFileSync(outFile, text)
        const run = Bun.spawnSync(["node", outFile], { cwd: dir, timeout: 10_000 })
        expect(run.exitCode).toBe(0)
        expect(run.stdout.toString().trim()).toBe("42")
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30_000)
