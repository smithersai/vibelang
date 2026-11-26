import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { ageDirectories, cacheProject, compilerOptions, skip } from "./cache-harness.mjs"

// Every case compiles a real project through the native compiler, so the
// sidecars and native declarations the cache must treat as outputs are the
// ones the compiler itself writes, at the paths it writes them.
//
// A project that sets vibe.sidecarDir and includes "." sets rootDir ".", the
// layout docs/design/src/007-tooling.md's mirrored-path examples assume.
const jsx = "declare namespace JSX { interface IntrinsicElements { [name: string]: unknown } }\n"

async function fixture(t, files, config = { include: ["src"] }) {
  const sources = Object.fromEntries(Object.entries(files).map(([name, text]) => [name.includes("/") ? name : "src/" + name, text]))
  const options = { ...compilerOptions, ...(config.vibe?.sidecarDir !== undefined ? { rootDir: "." } : {}), ...config.compilerOptions }
  const vibex = Object.keys(sources).some((name) => name.endsWith(".vibex"))
  if (vibex) sources["jsx.d.ts"] = jsx
  const include = vibex && config.include ? [...config.include, "jsx.d.ts"] : config.include
  const project = cacheProject(t, sources, { ...config, ...(include ? { include } : {}), compilerOptions: options })
  const directory = join(project.app, "src")
  ageDirectories(project.app)
  await project.settle()
  const cold = project.compile()
  assert.deepEqual(cold.result.errors, [], "the fixture compiles")
  assert.ok(cold.compiled)
  assert.ok(project.entry.lookup().result, "the compile was cached: " + cold.messages.join("\n"))
  // A later compile hits, or names the change that made it miss.
  const hit = (message) => {
    const run = project.compile()
    assert.deepEqual(run.result.errors, [])
    assert.equal(run.compiled, false, `${message}: ${run.messages.join("\n")}`)
  }
  const miss = (pattern, message) => {
    const run = project.compile()
    assert.ok(run.compiled, message)
    if (pattern) assert.match(run.messages.join("\n"), pattern)
    return run
  }
  return { ...project, directory, hit, miss }
}

test("sidecars the compiler writes beside their sources do not invalidate a successful compile", { skip }, async (t) => {
  const { directory, hit } = await fixture(t, { "main.vibe": "export const value = 1\n" })
  const sidecar = join(directory, "main.d.vibe.ts")
  assert.ok(existsSync(sidecar), "the compiler wrote the sidecar")
  hit("a generated sidecar is an output")
  writeFileSync(sidecar, "export declare const value: number;\n")
  hit("rewriting the generated output preserves the cache")
  unlinkSync(sidecar)
  hit("removing the generated output preserves the cache")
})

// Decided detail 268: with vibe.sidecarDir the sidecars mirror the sources
// under that directory, which is output even where include names it.
for (const sidecarDir of ["types", "gen/types", ".vibe/declarations", "${configDir}/types"]) {
  test("sidecars written under vibe.sidecarDir " + sidecarDir + " do not invalidate a successful compile", { skip }, async (t) => {
    const { app, hit } = await fixture(t, { "main.vibe": "export const value = 1\n", "other.vibe": "export const other = 2\n" }, { include: ["."], vibe: { sidecarDir } })
    const output = join(app, sidecarDir.replace("${configDir}/", ""))
    const sidecar = join(output, "src/main.d.vibe.ts")
    assert.ok(existsSync(sidecar), "the compiler wrote the sidecar under " + sidecarDir)
    hit("a generated sidecar is an output")
    writeFileSync(sidecar, "export declare const value: number;\n")
    writeFileSync(join(sidecar, "../other.d.vibe.ts"), "export {};\n")
    hit("rewriting the sidecar directory preserves the cache")
    rmSync(output, { recursive: true })
    hit("removing the sidecar directory preserves the cache")
  })
}

// VIP-27: a module's native declaration x.d.ts re-exports its sidecar and is
// an emit output like it, beside the source or under vibe.sidecarDir. Each
// rewrite is another form the compiler writes for some module.
const nativeForms = {
  "main.vibe": ['export * from "./main.vibe";\n', 'export * from "./main.vibe";\nexport { default } from "./main.vibe";\n'],
  "view.vibex": ['export * from "./view.vibex";\n', 'import vibe = require("./view.vibex");\nexport = vibe;\n']
}
for (const [source, texts] of Object.entries(nativeForms)) {
  const native = source.replace(/\.vibex?$/, ".d.ts")
  const text = source.endsWith(".vibex") ? "export const value = <div />\n" : "export const value = 1\n"
  for (const sidecarDir of [undefined, "types"]) {
    test(`a native declaration ${native} for ${source}${sidecarDir ? " under vibe.sidecarDir" : ""} does not invalidate a successful compile`, { skip }, async (t) => {
      const config = sidecarDir ? { include: ["."], vibe: { sidecarDir } } : { include: ["src"] }
      if (source.endsWith(".vibex")) config.compilerOptions = { ...compilerOptions, jsx: "preserve" }
      const { app, directory, hit } = await fixture(t, { [source]: text }, config)
      const at = sidecarDir ? join(app, sidecarDir, "src", native) : join(directory, native)
      assert.ok(existsSync(at), "the compiler wrote " + native)
      hit("the written native declaration is an output")
      for (const form of texts) {
        writeFileSync(at, form)
        hit("rewriting it in another form preserves the cache")
      }
      unlinkSync(at)
      hit("removing it preserves the cache")
    })
  }
}

test("a hand-written x.d.ts beside its .vibe module invalidates its directory snapshot", { skip }, async (t) => {
  const { directory, miss } = await fixture(t, { "main.vibe": "export const value = 1\n" })
  writeFileSync(join(directory, "main.d.ts"), "export declare const value: string;\n")
  miss(/main\.d\.ts changed|gained or lost a file/, "a declaration that is not the compiler's re-export is an input")
})

test("an x.d.ts re-exporting a module that does not exist stays an input", { skip }, async (t) => {
  const { directory, miss } = await fixture(t, { "main.ts": "export const value = 1\n" })
  writeFileSync(join(directory, "other.d.ts"), 'export * from "./other.vibe";\n')
  miss(/gained or lost a file/)
})

test("an orphan declaration sidecar added after a compile invalidates its directory snapshot", { skip }, async (t) => {
  const { directory, miss } = await fixture(t, { "main.ts": "export const value = 1\n" })
  writeFileSync(join(directory, "external.d.vibe.ts"), "export declare const external: number;\n")
  miss(/gained or lost a file/)
})

test("removing a sidecar's source still invalidates the cache", { skip }, async (t) => {
  const { directory, miss } = await fixture(t, { "main.vibe": "export const value = 1\n", "other.ts": "export const other = 2\n" })
  assert.ok(existsSync(join(directory, "main.d.vibe.ts")))
  unlinkSync(join(directory, "main.vibe"))
  miss(undefined, "the remaining sidecar does not hide a source deletion")
})

test("an orphan sidecar read by the compiler remains a content dependency", { skip }, async (t) => {
  const { directory, miss } = await fixture(t, {
    "main.ts": "export const value: number = outside\n",
    "external.d.vibe.ts": "declare const outside: number\n"
  })
  writeFileSync(join(directory, "external.d.vibe.ts"), "declare const outside: string\n")
  const run = miss(/external\.d\.vibe\.ts changed/)
  assert.ok(run.result.errors.some((error) => error.code === "TS2322"), "the recompile reads the edited sidecar")
})

// VIP-27: "`x.d.vibe.ts` is written next to each `x.vibe`" (0027-declaration-output.md).
// Metamorphic: generated declarations are outputs; their bytes and presence
// cannot change a cached compilation of the corresponding unchanged source.
test("cache-generated-sidecars", { skip }, async () => {
  await checkProperty(fc, {
    name: "cache-generated-sidecars",
    rule: "docs/design/vips/0027-declaration-output.md: Location; paired declaration sidecars are outputs",
    command: "node --test test/cache-sidecars.test.mjs",
    numRuns: 10,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      stem: fc.tuple(fc.constantFrom("main", "with.dot", "under_score", "dash-name", "Ω"), fc.integer({ min: 0, max: 1000 })).map(([prefix, n]) => prefix + n),
      linked: fc.boolean(),
      mutations: fc.array(fc.record({ remove: fc.boolean(), text: fc.string({ maxLength: 48 }) }), { minLength: 1, maxLength: 5 })
    }),
    check: async ({ stem, linked, mutations }) => {
      const cleanups = []
      const scope = { after: (fn) => cleanups.push(fn) }
      try {
        const source = stem + ".vibe"
        const files = linked
          ? { ".source-target": "export const value = 1\n", "other.ts": "export {}\n" }
          : { [source]: "export const value = 1\n" }
        let project
        if (linked) {
          // The source is a link to a file the project does not include.
          const bare = cacheProject(scope, Object.fromEntries(Object.entries(files).map(([name, text]) => ["src/" + name, text])),
            { include: ["src"], compilerOptions })
          symlinkSync(join(bare.app, "src/.source-target"), join(bare.app, "src", source))
          ageDirectories(bare.app)
          await bare.settle()
          assert.deepEqual(bare.compile().result.errors, [])
          project = { ...bare, directory: join(bare.app, "src"),
            hit(message) { const run = bare.compile(); assert.equal(run.compiled, false, `${message}: ${run.messages.join("\n")}`) } }
        } else project = await fixture(scope, files)
        const sidecar = join(project.directory, stem + ".d.vibe.ts")
        assert.ok(existsSync(sidecar), "the compiler wrote " + sidecar)
        project.hit("the paired sidecar the compile wrote invalidated the cache")
        for (const mutation of mutations) {
          if (mutation.remove) {
            if (existsSync(sidecar)) unlinkSync(sidecar)
          } else writeFileSync(sidecar, mutation.text)
          project.hit("paired output mutation invalidated cache")
        }
      } finally { for (const cleanup of cleanups) cleanup() }
    }
  })
})

// A directory setting can name a source root (detail 271). It must not
// suppress cache invalidation when a new source joins that root.
for (const sidecarDir of ["", ".", ".."]) {
  test("sidecarDir " + JSON.stringify(sidecarDir) + " preserves discovery of added sources", { skip }, async (t) => {
    const { app, miss } = await fixture(t, { "main.vibe": "export const value = 1\n" }, { include: ["."], vibe: { sidecarDir } })
    writeFileSync(join(app, "added.vibe"), "export const added = 2\n")
    const run = miss(/gained or lost a file/, "adding a source to the project invalidates the cached program")
    assert.ok(run.result.outputs.has(join(app, "added.vibe")), "the recompile emits the added source")
  })
}

test("a sidecar directory containing sources still detects added source inputs", { skip }, async (t) => {
  const { directory, miss } = await fixture(t, { "main.vibe": "export const value = 1\n" }, { include: ["."], vibe: { sidecarDir: "src" } })
  writeFileSync(join(directory, "added.vibe"), "export const added = 2\n")
  const run = miss(/gained or lost a file/, "an output directory does not prohibit source inputs")
  assert.ok(run.result.outputs.has(join(directory, "added.vibe")))
})

// VIP-27's paired sidecars are outputs; chapter 7's include still discovers
// genuine inputs, even when the configured output directory overlaps them.
test("cache-relocated-sidecars", { skip }, async (t) => {
  await checkProperty(fc, {
    name: "cache-relocated-sidecars",
    rule: "docs/design/vips/0027-declaration-output.md: directory amendment; docs/design/src/007-tooling.md: include and sidecarDir",
    command: "node --test test/cache-sidecars.test.mjs",
    numRuns: 8,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      directory: fc.constantFrom("types", "gen/types", "src", "src/gen", "", ".", "..", "$" + "{configDir}/types"),
      module: fc.constantFrom("a", "b", "Ω", "a.b")
    }),
    check: async ({ directory: sidecarDir, module }) => {
      const { app, directory, hit, miss } = await fixture(t, { [module + ".vibe"]: "export const value = 1\n" }, { include: ["."], vibe: { sidecarDir } })
      const output = join(app, sidecarDir.replace("$" + "{configDir}/", ""), "src", module + ".d.vibe.ts")
      assert.ok(existsSync(output), "the compiler wrote " + output)
      hit("a paired output does not change the source inventory")
      writeFileSync(output, "export declare const value: number;\n")
      hit("changing generated output is still no source change")
      writeFileSync(join(directory, "added.vibe"), "export const added = 2\n")
      miss(undefined, "adding a genuine source invalidates the cached program")
    }
  })
})

test("native JSX sources invalidate directory snapshots while their generated sidecars stay outputs", { skip }, async (t) => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(undefined, "types", "gen/types"),
    fc.constantFrom("Card", "View", "State"),
    async (sidecarDir, name) => {
      const source = name + ".vibex"
      const { app, directory, hit, miss } = await fixture(t, { [source]: "export const view = <div />\n" }, {
        include: ["."], compilerOptions: { ...compilerOptions, jsx: "preserve" }, ...(sidecarDir ? { vibe: { sidecarDir } } : {})
      })
      const output = sidecarDir ? join(app, sidecarDir, "src", name + ".d.vibex.ts") : join(directory, name + ".d.vibex.ts")
      assert.ok(existsSync(output), "the compiler wrote " + output)
      hit("a generated JSX sidecar is an output")
      writeFileSync(join(directory, "Added.vibex"), "export const added = <div />\n")
      miss(undefined, "a newly included native JSX source invalidates the cache")
    }
  ), { numRuns: 6, seed: 18127 })
})
