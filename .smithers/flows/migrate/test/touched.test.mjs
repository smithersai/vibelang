// verify's foreign-file check (touched.mjs): a batch changes its own modules
// and what the codemod recorded, and nothing else.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { batchScope, foreignChanges } from "../lib/touched.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-foreign-file.json", import.meta.url), "utf8"))

test("alchemy-5a: --fix rewriting an earlier batch's committed module is a foreign change", () => {
  assert.deepEqual(foreignChanges(corpus.changed, corpus.batch).map((c) => c.path), corpus.foreign)
})

test("a batch's renames, sidecars, platform siblings and the codemod's manifest and import edits are its own", () => {
  const batch = {
    files: [{ planned: "src/a.ts", path: "src/a.vibe", migrated: true }, { planned: "src/b.ts", path: "src/b.ts", migrated: false }],
    codemod: { platform: { splits: [{ file: "src/a.ts", platform: "src/a.platform.ts" }] }, refEdits: [{ file: "scripts/run.sh", from: "src/a.ts", to: "src/a.vibe" }], exportEdits: [{ manifest: "package.json", module: "src/a.vibe" }], importEdits: [{ file: "src/c.ts", from: "./a.js", to: "./a.vibe" }] }
  }
  const own = [
    { status: "R", path: "src/a.vibe", from: "src/a.ts" },
    { status: "A", path: "src/a.d.vibe.ts" },
    { status: "A", path: "src/a.platform.ts" },
    { status: "M", path: "package.json" },
    { status: "M", path: "scripts/run.sh" },
    { status: "M", path: "src/c.ts" },
    { status: "M", path: "src/b.ts" }
  ]
  assert.deepEqual(foreignChanges(own, batch), [])
  const foreign = [
    { status: "M", path: "src/a.test.ts" },
    { status: "M", path: "packages/other/package.json" },
    { status: "A", path: "src/config.d.ts" },
    { status: "R", path: "src/a.vibe", from: "src/z.ts" }
  ]
  assert.deepEqual(foreignChanges([...own, ...foreign], batch), foreign)
})

test("property: generated own changes are never foreign, and generated foreign ones always are", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 30 }),
    fc.boolean(), fc.boolean(),
    (states, manifest, braces) => {
      const stem = i => "src/" + (braces ? "{m" + i + "}" : "m" + i)
      const files = states.flatMap((state, i) => state === 1 || state === 2
        ? [{ planned: stem(i) + ".ts", path: stem(i) + (state === 2 ? ".vibe" : ".ts"), migrated: state === 2 }] : [])
      const codemod = {
        importEdits: states.flatMap((state, i) => state === 3 ? [{ file: stem(i) + ".ts" }] : []),
        refEdits: states.flatMap((state, i) => state === 3 ? [{ file: "config/reference" + i + ".json" }] : []),
        exportEdits: manifest ? [{ manifest: "package.json" }] : [],
        platform: { splits: files.filter(f => f.migrated).map(f => ({ platform: f.path.replace(/\\.vibe$/, ".platform.ts") })) }
      }
      const own = [
        ...files.map(f => f.migrated ? { status: "R", path: f.path, from: f.planned } : { status: "M", path: f.path }),
        ...files.filter(f => f.migrated).map(f => ({ status: "A", path: f.path.replace(/\\.vibe$/, ".d.vibe.ts") })),
        ...codemod.platform.splits.map(s => ({ status: "A", path: s.platform })),
        ...codemod.importEdits.map(e => ({ status: "M", path: e.file })),
        ...codemod.refEdits.map(e => ({ status: "M", path: e.file })),
        ...codemod.exportEdits.map(e => ({ status: "M", path: e.manifest }))
      ]
      const foreign = [
        ...states.map((_, i) => ({ status: "M", path: stem(i) + ".test.ts" })),
        ...states.flatMap((state, i) => state === 0 || state === 4 ? [{ status: "M", path: stem(i) + (state === 4 ? ".vibe" : ".ts") }] : []),
        { status: "M", path: "packages/other/package.json" },
        ...(files.length ? [{ status: "R", path: files[0].path, from: "foreign.ts" }] : [])
      ]
      assert.deepEqual(foreignChanges([...own, ...foreign], { files, codemod }), foreign)
    }), { seed: 50131, numRuns: 300 })
})

test("property: durable source selectors and native Vite script receipts authorize only their recorded paths", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 1, maxLength: 12 }), ids => {
    const codemod = {
      referenceEdits: ids.map(i => ({ file: "scripts/select" + i + ".ts", kind: "source-glob" })),
      scriptEdits: ids.map(i => ({ manifest: "packages/p" + i + "/package.json", script: "dev" }))
    }
    const own = [...codemod.referenceEdits.map(e => ({ status: "M", path: e.file })), ...codemod.scriptEdits.map(e => ({ status: "M", path: e.manifest }))]
    const foreign = [{ status: "M", path: "scripts/unrecorded.ts" }, { status: "M", path: "packages/other/package.json" }]
    assert.deepEqual(foreignChanges([...own, ...foreign], { files: [], codemod }), foreign)
    assert.deepEqual(foreignChanges(own, { files: [], codemod: {} }), own)
  }), { seed: 410411, numRuns: 150 })
})

test("property: only freshly certified protected edits enter the scope, never a failed proof or an unrelated manifest", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 99 }), fc.boolean(), fc.boolean(), (id, allOk, fileOk) => {
    const file = "test/t" + id + ".test.ts"
    const changed = [{ status: "M", path: file }, { status: "M", path: "package.json" }]
    const testDiff = { ok: allOk, files: [{ file, ok: fileOk }, { file: "package.json", ok: true }] }
    assert.deepEqual(foreignChanges(changed, { files: [], codemod: {}, testDiff }),
      allOk && fileOk ? [changed[1]] : changed)
  }), { seed: 410412, numRuns: 150 })
})

// loadercold-opencode's emit writes <package>/.vibelang/js/.loader/<tsconfig>.json
// each time it writes the package's JavaScript; verify called that record foreign.
test("the emit's JavaScript and loader records are the flow's own, in any package", () => {
  const own = [
    { status: "A", path: "app/.vibelang/js/.loader/tsconfig.json.json" },
    { status: "M", path: "packages/core/.vibelang/js/.loader/tsconfig.build.json.json" },
    { status: "A", path: "app/.vibelang/js/src/index.js" },
    { status: "A", path: ".vibelang/js/src/index.js" }
  ]
  assert.deepEqual(foreignChanges(own, { files: [], codemod: {} }), [])
})

test("property: only paths under a .vibelang/js directory leave the foreign check", () => {
  const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/)
  const dir = fc.array(segment, { maxLength: 3 }).map((parts) => parts.map((part) => part + "/").join(""))
  fc.assert(fc.property(dir, segment, (prefix, name) => {
    const batch = { files: [], codemod: {} }
    assert.deepEqual(foreignChanges([{ status: "A", path: prefix + ".vibelang/js/" + name + ".js" }], batch), [])
    const foreign = [
      { status: "A", path: prefix + ".vibelang/oxlint.mjs" },
      { status: "A", path: prefix + ".vibelang/js-old/" + name + ".js" },
      { status: "A", path: prefix + "x.vibelang/js/" + name + ".js" },
      { status: "M", path: prefix + "src/" + name + ".ts" },
      { status: "R", path: prefix + ".vibelang/js/" + name + ".js", from: prefix + "src/" + name + ".ts" }
    ]
    assert.deepEqual(foreignChanges(foreign, batch), foreign)
  }), { seed: 411021, numRuns: 150 })
})

test("packing receipts authorize only the exact generated policy and ignore files",()=>{
 const codemod={emittedJs:[{packingFiles:["packages/code/.npmignore","packages/code/.vibelang/pack-policy.json"]}]}
 const own=codemod.emittedJs[0].packingFiles.map(path=>({status:"M",path}))
 const foreign=[{status:"M",path:"packages/other/.npmignore"},{status:"M",path:"packages/code/secret.txt"},{status:"M",path:"packages/code/.gitignore"}]
 assert.deepEqual(foreignChanges([...own,...foreign],{files:[],codemod}),foreign)
 assert.deepEqual(foreignChanges(own,{files:[],codemod:{}}),own)
})
