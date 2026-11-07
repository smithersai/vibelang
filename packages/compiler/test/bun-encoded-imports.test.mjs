import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")

function check({ name, hops, value, writtenJs = false, mixed = false, reverse = false }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-encoded-")))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
    symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] },
      include: ["vibe/*.vibe"]
    }))
    for (const extension of ["vibe", "ts"]) {
      const directory = join(root, extension)
      mkdirSync(directory)
      writeFileSync(join(directory, name + "." + extension), `export const value = ${value}\n`)
      if ((writtenJs || mixed) && name.includes("%25")) {
        writeFileSync(join(directory, name.replace("%25", "%") + "." + extension), `export const value = ${value + 1}\n`)
      }
      let specifier = "./" + name + (writtenJs ? ".js" : "." + extension)
      for (let i = 0; i < hops; i++) {
        if (mixed && i === 0) {
          const imports = [
            `import { value as source } from ${JSON.stringify("./" + name.replace("%25", "%") + "." + extension)}`,
            `import { value as native } from ${JSON.stringify("./" + name + ".js")}`
          ]
          if (reverse) imports.reverse()
          writeFileSync(join(directory, `hop${i}.${extension}`), imports.join("\n") + "\nexport const value = source + native\n")
        } else {
          writeFileSync(join(directory, `hop${i}.${extension}`), `export { value } from ${JSON.stringify(specifier)}\n`)
        }
        specifier = `./hop${i}.${extension}`
      }
      writeFileSync(join(directory, "entry.ts"), `import { value } from ${JSON.stringify(specifier)}\nconsole.log(value)\n`)
    }
    const env = { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache") }
    delete env.NODE_TEST_CONTEXT
    const bun = process.env.VIBELANG_TEST_BUN || "bun"
    const typed = spawnSync(process.execPath, [join(modules, "typescript/bin/tsc"),
      "--noEmit", "--strict", "--module", "esnext", "--moduleResolution", "bundler",
      "--allowImportingTsExtensions", "--skipLibCheck", "ts/entry.ts"
    ], { cwd: root, env, encoding: "utf8", timeout: 20000 })
    assert.equal(typed.status, 0, typed.stdout + typed.stderr)
    const twin = spawnSync(bun, ["ts/entry.ts"], { cwd: root, env, encoding: "utf8", timeout: 20000 })
    assert.equal(twin.status, 0, twin.stdout + twin.stderr)
    assert.equal(twin.stdout.trim(), String(mixed ? value * 2 + 1 : value))
    const result = spawnSync(bun, ["--preload", "vibelang/bun", "vibe/entry.ts"], { cwd: root, env, encoding: "utf8", timeout: 20000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.stdout, twin.stdout, "the source graph keeps its TypeScript value")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Bun resolves encoded emitted names back to their original source filenames", () =>
  check({ name: "percent%name", hops: 1, value: 42 }))

test("written JavaScript specifiers retain native literal-percent filename precedence", () =>
  check({ name: "literal%25name", hops: 1, value: 42, writtenJs: true }))

test("Bun source imports match TypeScript across encoded paths and re-exports", async () => {
  await checkProperty(fc, {
    name: "bun-encoded-imports",
    rule: "compiled source imports retain the original filesystem target",
    command: "node --test packages/compiler/test/bun-encoded-imports.test.mjs",
    arbitrary: fc.record({
      name: fc.constantFrom("percent%name", "hash#name", "space name", "snow-雪", "literal%25name"),
      hops: fc.integer({ min: 1, max: 3 }), value: fc.integer()
    }),
    numRuns: 15, check
  })
})

for (const name of ["literal%25name", "quote'\"%25name"]) {
  for (const reverse of [false, true]) {
    test(`Bun keeps colliding imports distinct for ${name} in order ${reverse}`, () =>
      check({ name, hops: 1, value: 42, mixed: true, reverse }))
  }
}

test("Bun retains each original target in generated mixed import graphs", async () => {
  await checkProperty(fc, {
    name: "bun-mixed-encoded-imports",
    rule: "source-extension and written JavaScript imports retain their distinct TypeScript targets",
    command: "node --test packages/compiler/test/bun-encoded-imports.test.mjs",
    arbitrary: fc.record({
      name: fc.constantFrom("literal%25name", "space %25name", "hash#%25name", "snow-雪%25name", "quote'\"%25name"),
      hops: fc.integer({ min: 1, max: 3 }), value: fc.integer({ min: -100, max: 100 }),
      reverse: fc.boolean()
    }),
    numRuns: 12,
    check: (input) => check({ ...input, mixed: true })
  })
})
