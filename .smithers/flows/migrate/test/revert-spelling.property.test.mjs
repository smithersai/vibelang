import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { pathAliases, renameBatch, rewriteImports } from "../lib/codemod.mjs"
import { makeConfig, paths, revertMany } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { prepareState, applyState, saveState } from "../lib/codemod-state.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))

// t3code Mobile (drive-t3code-apps, 2026-11-03T13:46Z): one batch converted
// connection/onboarding.ts and connection/runtime.ts; revert returned runtime
// to TypeScript, and onboarding.vibe's `./runtime` came back as `./runtime.ts`.
// 87 such specifiers in 53 files, each resolving to the same TypeScript file,
// changed the inferred declarations that print them. Revert puts back what the
// repository wrote, in a consumer converted in the same batch too: the result
// equals a codemod that never converted the module (decided detail 272).
async function fixture({ modules, importers, convert, reverted, journal, compile = false }) {
  const root = mkdtempSync(join(tmpdir(), "migrate-revert-spelling-")), target = join(root, "repo"), run = join(root, "run")
  try {
    const files = {
      "package.json": "{}\n",
      "tsconfig.json": JSON.stringify({ compilerOptions: { module: "Preserve", moduleResolution: "Bundler", target: "ES2022", strict: true, allowArbitraryExtensions: true, allowImportingTsExtensions: true, noEmit: true }, include: ["src/**/*"] })
    }
    for (const m of modules) files[m.path] = `export const ${m.name} = ${JSON.stringify(m.name)}\n`
    for (const u of importers) files[u.path] = u.imports.map(i => `import { ${i.name} } from "${i.specifier}"\n`).join("") + `export const ${u.name} = [${u.imports.map(i => i.name).join(", ")}]\n`
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(target, file)), { recursive: true }); writeFileSync(join(target, file), text)
    }
    if (compile) {
      mkdirSync(join(target, "node_modules"), { recursive: true })
      symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    }
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "base")
    writeJson(paths(run).config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(paths(run).plan, { batches: [{ files: convert }] })
    const scope = [...modules, ...importers].map(f => f.path)
    const aliases = pathAliases(ts, target)
    let renames, importEdits
    if (journal) {
      const state = prepareState(target, convert, scope, { aliases })
      saveState(paths(run).codemodState("01"), state)
      applyState(target, state)
      ;({ renames, importEdits } = state)
    } else {
      renames = renameBatch(target, convert)
      const moved = renames.map(r => r.to)
      importEdits = rewriteImports(target, scope.map(f => convert.includes(f) ? f.replace(/\.ts$/, ".vibe") : f), moved, aliases)
    }
    writeJson(paths(run).codemod("01"), { importEdits, renames })
    await revertMany({ run, batch: "01", files: reverted.map(file => ({ file: file.replace(/\.ts$/, ".vibe"), reason: "revert spelling witness" })) })
    const back = new Set(reverted)
    for (const u of importers) {
      const now = existsSync(join(target, u.path)) ? u.path : u.path.replace(/\.ts$/, ".vibe")
      const text = readFileSync(join(target, now), "utf8")
      for (const i of u.imports) {
        if (!back.has(i.target)) continue
        assert.ok(text.includes(`from "${i.specifier}"`), `${now} should name ${i.target} as ${i.specifier}, not:\n${text}`)
      }
    }
    if (compile) {
      const result = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false", "--singleThreaded"], { cwd: target, encoding: "utf8" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

const mobileCorpus = JSON.parse(readFileSync(new URL("./corpus/t3code-mobile-revert-written-specifier.json", import.meta.url), "utf8"))
const mobile = mobileCorpus.input

test("the keyed T3code Mobile reversion corpus quotes the tooling contract and retains its literal sources", () => {
  const rule = "Existing tools work."
  const spec = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
  assert.ok(spec.includes(rule))
  assert.equal(mobileCorpus.rule, rule)
  assert.equal(mobileCorpus.repo, "t3code")
  assert.equal(mobileCorpus.key, "t3code:mobile:revert-written-specifier")
  for (const m of mobile.modules) {
    assert.equal(mobileCorpus.source[m.path], `export const ${m.name} = ${JSON.stringify(m.name)}\n`)
  }
  for (const u of mobile.importers) {
    assert.equal(mobileCorpus.source[u.path], u.imports.map(i => `import { ${i.name} } from "${i.specifier}"\n`).join("") + `export const ${u.name} = [${u.imports.map(i => i.name).join(", ")}]\n`)
  }
})

for (const journal of [false, true]) {
  test(`revert keeps the written specifier in a consumer the same batch converted (t3code Mobile, ${journal ? "journal" : "codemod record"})`, () => fixture({
    ...mobile, journal, compile: existsSync(compiler),
    convert: ["src/connection/onboarding.ts", "src/connection/runtime.ts", "src/persistence/mobile-storage.ts"],
    reverted: ["src/connection/runtime.ts", "src/persistence/mobile-storage.ts"]
  }))
}

test("revert restores every importer's written spelling, converted or not", async () => {
  const arbitrary = fc.record({
    picks: fc.array(fc.record({ module: fc.nat(2), spelling: fc.nat(2) }), { minLength: 1, maxLength: 3 }),
    picks2: fc.array(fc.record({ module: fc.nat(2), spelling: fc.nat(2) }), { minLength: 1, maxLength: 3 }),
    convertImporters: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
    revertMask: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }).filter(m => m.some(Boolean)),
    journal: fc.boolean()
  })
  await fc.assert(fc.asyncProperty(arbitrary, async ({ picks, picks2, convertImporters, revertMask, journal }) => {
    const modules = [0, 1, 2].map(k => ({ path: k === 2 ? "src/lib/m2.ts" : `src/m${k}.ts`, name: `m${k}` }))
    const spell = (k, s, fromLib) => {
      const dir = k === 2 ? (fromLib ? "./" : "./lib/") : (fromLib ? "../" : "./")
      return [`${dir}m${k}`, `${dir}m${k}.js`, `${dir}m${k}.ts`][s]
    }
    const uniq = list => [...new Map(list.map(p => [p.module, p])).values()]
    const importers = [
      { path: "src/u0.ts", name: "u0", imports: uniq(picks).map(p => ({ name: `m${p.module}`, specifier: spell(p.module, p.spelling, false), target: modules[p.module].path })) },
      { path: "src/lib/u1.ts", name: "u1", imports: uniq(picks2).map(p => ({ name: `m${p.module}`, specifier: spell(p.module, p.spelling, true), target: modules[p.module].path })) }
    ]
    const convert = [...modules.map(m => m.path), ...importers.filter((_, i) => convertImporters[i]).map(u => u.path)]
    const reverted = modules.filter((_, i) => revertMask[i]).map(m => m.path)
    await fixture({ modules, importers, convert, reverted, journal })
  }), { seed: 20261103, numRuns: 64 })
})
