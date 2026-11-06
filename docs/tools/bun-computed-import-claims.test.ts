import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkBunImportGuides, findComputedAliasClaims } from "./bun-computed-import-claims.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const original = 'For computed dynamic imports, use a relative or absolute source path, such as\n' +
  '`const name = "./src/feature.vibe"; await import(name)`. Bun does not invoke\n' +
  'runtime resolver hooks for computed bare aliases such as `import(alias)`\n' +
  'where `alias` is `"@/feature.ts"`; use a literal alias import instead.\n' +
  'This [Bun runtime limitation](https://github.com/oven-sh/bun/issues/40579)\n' +
  'also affects extensionless aliases.'

test("public Bun guides distinguish the preload from the extensionless runtime limitation", () => {
  expect(checkBunImportGuides(root)).toEqual([])
})

test("a later extensionless sentence does not qualify a categorical .ts claim", () => {
  expect(findComputedAliasClaims(original)).toHaveLength(1)
  expect(findComputedAliasClaims(original)[0].line).toBe(2)
  expect(findComputedAliasClaims("# Guide\n\n" + original)[0].line).toBe(4)
  expect(findComputedAliasClaims("```markdown\n" + original + "\n```")).toEqual([])
  expect(findComputedAliasClaims("~~~markdown\n" + original + "\n~~~")).toEqual([])
  expect(findComputedAliasClaims("Bun does not invoke runtime resolver hooks for computed extensionless bare aliases.")).toEqual([])
  expect(findComputedAliasClaims("The preload does not support computed bare aliases. Bun does not invoke resolver hooks for computed bare aliases without extensions.")).toEqual([])
  expect(findComputedAliasClaims("Bun invokes runtime resolver hooks for computed bare aliases ending in `.ts`.")).toEqual([])
  expect(findComputedAliasClaims("The Bun preload does not invoke resolver hooks for computed bare aliases.")).toEqual([])
})

test("generated categorical claims require their own extensionless qualification", () => {
  fc.assert(fc.property(
    fc.constantFrom("does not", "never", "cannot", "fails to"),
    fc.constantFrom("invoke", "call", "trigger"),
    fc.constantFrom("resolver hooks", "onResolve"),
    fc.constantFrom("aliases", "imports", "specifiers"),
    fc.constantFrom(" ", "\n", "\n  "),
    (negative, verb, hook, noun, space) => {
      const claim = `Bun ${negative} ${verb} ${hook} for computed bare ${noun}`
      const wrap = text => text.replaceAll(" ", space)
      expect(findComputedAliasClaims(wrap(claim + ". This also affects extensionless aliases."))).toHaveLength(1)
      expect(findComputedAliasClaims(wrap(claim.replace("computed", "computed extensionless") + "."))).toEqual([])
      expect(findComputedAliasClaims(wrap(claim + " without extensions."))).toEqual([])
    }
  ), { numRuns: 200 })
})

test("native Bun reaches computed .ts alias hooks and loads computed source paths", () => {
  const fixture = mkdtempSync(join(tmpdir(), "bun-computed-imports-"))
  try {
    mkdirSync(join(fixture, "src"))
    writeFileSync(join(fixture, "tsconfig.json"), JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"] } }
    }))
    writeFileSync(join(fixture, "src/feature.vibe"), "export const value = 42\n")
    writeFileSync(join(fixture, "plugin.mjs"), `
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
globalThis.resolveEvents = []
Bun.plugin({ name: "computed-import-control", setup(build) {
  build.onResolve({ filter: /^@\\// }, args => {
    globalThis.resolveEvents.push(args.path)
    return { path: fileURLToPath(new URL("./src/feature.vibe", import.meta.url)) }
  })
  build.onLoad({ filter: /\\.vibe$/ }, args => ({
    contents: readFileSync(args.path, "utf8"), loader: "js"
  }))
} })
`)
    writeFileSync(join(fixture, "driver.mjs"), `
const name = process.env.COMPUTED_IMPORT
try {
  const module = await import(name)
  console.log(JSON.stringify({ ok: true, value: module.value, hooks: globalThis.resolveEvents }))
} catch {
  console.log(JSON.stringify({ ok: false, hooks: globalThis.resolveEvents }))
}
`)
    const run = (specifier: string) => {
      const child = Bun.spawnSync([process.execPath, "--preload", "./plugin.mjs", "driver.mjs"], {
        cwd: fixture, env: { ...process.env, COMPUTED_IMPORT: specifier }, timeout: 10_000
      })
      expect(child.exitCode, child.stderr.toString()).toBe(0)
      return JSON.parse(child.stdout.toString())
    }
    fc.assert(fc.property(
      fc.array(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), { minLength: 1, maxLength: 3 }),
      parts => {
        const alias = "@/" + parts.join("/")
        expect(run(alias + ".ts")).toEqual({ ok: true, value: 42, hooks: [alias + ".ts"] })
        expect(run(alias)).toEqual({ ok: false, hooks: [] })
      }
    ), { numRuns: 20 })
    for (const specifier of ["./src/feature.vibe", join(fixture, "src/feature.vibe")]) {
      expect(run(specifier)).toEqual({ ok: true, value: 42, hooks: [] })
    }
  } finally { rmSync(fixture, { recursive: true, force: true }) }
}, 60_000)
