// Decided 04:00Z (B), beside detail 272: a source-discovery test's extension
// regex selects .vibe modules and excludes their x.d.vibe.ts sidecars, with a
// selected-set identity proof. Minimized from t3code's
// apps/web/src/reactCompilerCoverage.test.ts and apps/mobile/src/dependency-graph.test.ts.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { checkSelectorEdits, rewriteSourceLiterals } from "../lib/source-paths.mjs"
import { verifyTestDiff } from "../lib/test-diff.mjs"
import { widenExtensionRegex } from "../lib/regex-selectors.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

const web = `import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { transform } from "oxc-transform-react";
import { expect, it } from "vitest";

const sourceFiles = NodeFS.readdirSync(NodePath.join(import.meta.dirname), {
  recursive: true,
})
  .map(String)
  .filter((file) => /\\.tsx?$/.test(file) && !/\\.(test|browser)\\.tsx?$/.test(file))
  .filter((file) => !file.endsWith(".gen.ts"))
  .map((file) => \`apps/web/src/\${file}\`);

it.each(sourceFiles)("%s compiles with the React Compiler", (file) => {
  const result = transform(file, NodeFS.readFileSync(file, "utf8"), { reactCompiler: true });
  expect(result.errors).toEqual([]);
});
`
const mobile = `import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const isGraphFile = (filePath: string): boolean =>
  /\\.tsx?$/.test(filePath) &&
  !filePath.includes(".test.") &&
  !filePath.includes("test-support") &&
  !filePath.endsWith(".d.ts");

export const graphFiles = (root: string) =>
  NodeFS.readdirSync(root, { recursive: true }).map(String).filter(isGraphFile);
`
const inventory = [
  "package.json", "apps/web/package.json", "apps/web/src/reactCompilerCoverage.test.ts",
  "apps/web/src/modelOrdering.ts", "apps/web/src/App.tsx", "apps/web/src/routeTree.gen.ts",
  "apps/web/src/state/query.ts", "apps/web/src/state/query.test.ts", "apps/web/src/env.d.ts",
  "apps/mobile/package.json", "apps/mobile/src/dependency-graph.test.ts",
  "apps/mobile/src/connection/catalog-store.ts", "apps/mobile/src/connection/background-activity.ts",
  "apps/mobile/src/test-support/fake.ts", "apps/mobile/src/App.tsx"
]
const webRenames = [{ from: "apps/web/src/modelOrdering.ts", to: "apps/web/src/modelOrdering.vibe" }, { from: "apps/web/src/state/query.ts", to: "apps/web/src/state/query.vibe" }]
const mobileRenames = [{ from: "apps/mobile/src/connection/catalog-store.ts", to: "apps/mobile/src/connection/catalog-store.vibe" }, { from: "apps/mobile/src/connection/background-activity.ts", to: "apps/mobile/src/connection/background-activity.vibe" }]
const widened = "/(?<!\\.d\\.vibe)\\.(?:tsx?|vibe)$/"

const trees = (renames, file, beforeText, afterText) => {
  const before = Object.fromEntries(inventory.map(p => [p, null]))
  const after = Object.fromEntries(inventory.filter(p => !renames.some(r => r.from === p)).map(p => [p, null]))
  for (const r of renames) { after[r.to] = null; after[r.to.replace(/\.vibe$/, ".d.vibe.ts")] = null }
  before[file] = beforeText
  after[file] = afterText
  return { before, after }
}
const verify = (renames, file, beforeText, afterText, extra = {}) => {
  const scratch = mkdtempSync(join(tmpdir(), "source-regex-"))
  try { return verifyTestDiff({ ts, ...trees(renames, file, beforeText, afterText), renames, scratch, ...extra }) }
  finally { rmSync(scratch, { recursive: true, force: true }) }
}

test("t3code web: the coverage test's extension regex selects .vibe modules and no sidecar", () => {
  const file = "apps/web/src/reactCompilerCoverage.test.ts"
  const changed = rewriteSourceLiterals(ts, web, file, webRenames, { inventory })
  assert.deepEqual(changed.warnings, [])
  assert.equal(changed.edits.length, 1)
  assert.equal(changed.edits[0].kind, "source-regex")
  assert.equal(changed.text, web.replace("/\\.tsx?$/.test(file) &&", widened + ".test(file) &&"))
  const proof = changed.selectorChecks[0]
  assert.equal(proof.pass, true, JSON.stringify(proof))
  assert.equal(proof.contexts[0].base, "apps/web")
  assert.deepEqual(proof.contexts[0].mapped, proof.contexts[0].before)
  assert.ok(proof.contexts[0].after.includes("apps/web/src/modelOrdering.vibe"))
  assert.ok(!proof.contexts[0].after.some(p => p.endsWith(".d.vibe.ts")))
  const result = verify(webRenames, file, web, changed.text)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.files[0].hunks[0].setCheck.ok, true)
  // The receipt holds at verify and record time, and only for the text it proved.
  const after = [...inventory.filter(p => !webRenames.some(r => r.from === p)), ...webRenames.map(r => r.to)]
  const receipt = { renames: webRenames, referenceEdits: changed.edits, selectorChecks: changed.selectorChecks }
  assert.ok(checkSelectorEdits(receipt, after, { ts, read: () => changed.text }).every(c => c.pass))
  assert.equal(checkSelectorEdits(receipt, after, { ts, read: () => web })[0].pass, false)
})

test("t3code mobile: the dependency graph's named predicate widens the same way", () => {
  const file = "apps/mobile/src/dependency-graph.test.ts"
  const changed = rewriteSourceLiterals(ts, mobile, file, mobileRenames, { inventory })
  assert.equal(changed.edits.length, 1)
  assert.equal(changed.text, mobile.replace("/\\.tsx?$/.test(filePath)", widened + ".test(filePath)"))
  assert.equal(changed.selectorChecks[0].pass, true)
  assert.equal(verify(mobileRenames, file, mobile, changed.text).ok, true)
})

test("a rename another path test tells apart is refused, and verify refuses the same edit", () => {
  const file = "apps/web/src/reactCompilerCoverage.test.ts"
  const renames = [...webRenames, { from: "apps/web/src/routeTree.gen.ts", to: "apps/web/src/routeTree.gen.vibe" }]
  const changed = rewriteSourceLiterals(ts, web, file, renames, { inventory })
  assert.equal(changed.text, web)
  assert.match(changed.warnings.join("\n"), /cannot widen/)
  const forced = web.replace("/\\.tsx?$/.test(file) &&", widened + ".test(file) &&")
  const result = verify(renames, file, web, forced)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result), /another path test/)
})

test("regexes that strip, sit in an assertion, or filter no listed directory stay as written", () => {
  const renames = webRenames
  for (const source of [
    'import * as fs from "node:fs"; const names = fs.readdirSync("src").map(f => f.replace(/\\.tsx?$/, ""))',
    'import * as fs from "node:fs"; fs.readdirSync("src"); expect(/\\.tsx?$/.test(resolved)).toBe(true)',
    'export const isSource = (f: string) => /\\.tsx?$/.test(f)',
    'import * as fs from "node:fs"; const R = /\\.tsx?$/; const n = fs.readdirSync("src").filter(f => R.test(f)); const s = "x".split(R)',
    'import * as fs from "node:fs"; const n = fs.readdirSync("src").filter(f => /\\.tsx?$/g.test(f))',
  ]) {
    const changed = rewriteSourceLiterals(ts, source, "apps/web/src/a.test.ts", renames, { inventory })
    assert.equal(changed.text, source, source)
  }
})

test("verify accepts only the canonical widening: a bare /\\.(tsx?|vibe)$/ selects sidecars", () => {
  const file = "apps/web/src/reactCompilerCoverage.test.ts"
  const loose = web.replace("/\\.tsx?$/.test(file) &&", "/\\.(tsx?|vibe)$/.test(file) &&")
  assert.equal(verify(webRenames, file, web, loose).ok, false)
  const other = web.replace("/\\.tsx?$/.test(file) &&", "/\\.(?:tsx?|vibe|js)$/.test(file) &&")
  assert.equal(verify(webRenames, file, web, other).ok, false)
})

test("a .vibe module the repository already had would join the selection, so the proof fails", () => {
  const file = "apps/web/src/reactCompilerCoverage.test.ts"
  const changed = rewriteSourceLiterals(ts, web, file, webRenames, { inventory: [...inventory, "apps/web/src/legacy.vibe"] })
  assert.equal(changed.text, web)
  assert.equal(changed.selectorChecks[0].pass, false)
  assert.deepEqual(changed.selectorChecks[0].contexts[0].added, ["apps/web/src/legacy.vibe"])
})

// The filter the test runs, evaluated on each tree: the original regex on the
// TypeScript tree, the rewritten one on the migrated tree with its sidecars.
const runFilter = (regexText, paths, exclusions) => {
  const end = regexText.lastIndexOf("/"), re = new RegExp(regexText.slice(1, end), regexText.slice(end + 1))
  return paths.filter(p => re.test(p) && !exclusions.some(x => x.kind === "endsWith" ? p.endsWith(x.text) : p.includes(x.text)))
}

test("property: a rewrite keeps the selected set of the whole filter, and verify agrees with the codemod", () => {
  let rewrote = 0
  const groups = ["ts", "tsx?", "(ts|tsx)", "(?:ts|tsx)", "m?ts", "[cm]?tsx?"]
  const stem = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/)
  const ext = fc.constantFrom(".ts", ".tsx", ".mts", ".d.ts", ".gen.ts", ".test.ts", ".js", ".json")
  const exclusion = fc.constantFrom({ kind: "endsWith", text: ".gen.ts" }, { kind: "endsWith", text: ".d.ts" }, { kind: "includes", text: ".test." }, { kind: "includes", text: "test-support" })
  fc.assert(fc.property(
    fc.uniqueArray(fc.tuple(fc.constantFrom("src", "src/a", "src/test-support"), stem, ext).map(([d, s, e]) => d + "/" + s + e), { minLength: 1, maxLength: 12 }),
    fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
    fc.constantFrom(...groups), fc.constantFrom("", "i"), fc.uniqueArray(exclusion, { maxLength: 3, selector: x => x.text }),
    (paths, picks, group, flags, exclusions) => {
      const renames = paths.map((p, i) => [p, picks[i]]).filter(([p, pick]) => pick && /\.(?:ts|mts)$/.test(p) && !/\.(?:d|test)\.ts$/.test(p))
        .map(([p]) => ({ from: p, to: p.replace(/\.m?ts$/, ".vibe") }))
        .filter((r, i, all) => all.findIndex(o => o.to === r.to) === i && !paths.includes(r.to))
      const regexText = "/\\." + group + "$/" + flags
      const predicate = [regexText + ".test(file)", ...exclusions.map(x => "!file." + x.kind + "(" + JSON.stringify(x.text) + ")")].join(" && ")
      const source = 'import * as fs from "node:fs";\nexport const files = fs.readdirSync("src", { recursive: true }).map(String).filter((file) => ' + predicate + ");\n"
      const file = "test/discovery.test.ts"
      const all = ["package.json", file, ...paths]
      const changed = rewriteSourceLiterals(ts, source, file, renames, { inventory: all })
      const regexEdit = changed.edits.find(e => e.kind === "source-regex")
      if (!regexEdit) return
      rewrote++
      assert.equal(regexEdit.to, widenExtensionRegex(regexText))
      const afterPaths = [...all.filter(p => !renames.some(r => r.from === p)), ...renames.flatMap(r => [r.to, r.to.replace(/\.vibe$/, ".d.vibe.ts")])]
      const fromOf = new Map(renames.map(r => [r.to, r.from]))
      const before = runFilter(regexText, all, exclusions).sort()
      const after = runFilter(regexEdit.to, afterPaths, exclusions).map(p => fromOf.get(p) ?? p).sort()
      assert.deepEqual(after, before)
      const scratch = mkdtempSync(join(tmpdir(), "source-regex-prop-"))
      try {
        const b = Object.fromEntries(all.map(p => [p, null])), a = Object.fromEntries(afterPaths.map(p => [p, null]))
        b[file] = source; a[file] = changed.text
        const result = verifyTestDiff({ ts, before: b, after: a, renames: renames.filter(r => r.from.endsWith(".ts")), scratch })
        if (renames.every(r => r.from.endsWith(".ts"))) assert.equal(result.ok, true, JSON.stringify(result))
      } finally { rmSync(scratch, { recursive: true, force: true }) }
    }), { seed: 4002272, numRuns: 300 })
  assert.ok(rewrote >= 50, "only " + rewrote + " generated filters were rewritten")
})

test("an earlier batch's .vibe module and sidecar keep their identity: the unwidened regex selected the sidecar", () => {
  // t3code's packages/client-runtime was migrated before apps/web: /\.tsx?$/ then selects its x.d.vibe.ts.
  const file = "apps/web/src/reactCompilerCoverage.test.ts"
  const earlier = ["apps/web/src/legacy.vibe", "apps/web/src/legacy.d.vibe.ts"]
  const changed = rewriteSourceLiterals(ts, web, file, webRenames, { inventory: [...inventory, ...earlier] })
  assert.equal(changed.edits.length, 1)
  assert.equal(changed.selectorChecks[0].pass, true, JSON.stringify(changed.selectorChecks[0]))
  assert.ok(changed.selectorChecks[0].contexts[0].after.includes("apps/web/src/legacy.vibe"))
  assert.ok(!changed.selectorChecks[0].contexts[0].after.includes("apps/web/src/legacy.d.vibe.ts"))
})

test("a module an expected-value map names by its .ts path blocks the widening and is named in the warning", () => {
  // t3code's mobile KNOWN_BAILOUTS: renaming a listed module would turn its entry stale.
  const file = "apps/mobile/src/reactCompilerCoverage.test.ts"
  const source = `import * as NodeFS from "node:fs";
const KNOWN_BAILOUTS: Record<string, string> = { "src/connection/catalog-store.ts": "ref read during render" };
export const sourceFiles = NodeFS.readdirSync("src", { recursive: true }).map(String)
  .filter((file) => /\\.tsx?$/.test(file) && !/\\.(test\\.tsx?|d\\.ts)$/.test(file)).map((file) => \`src/\${file}\`);
`
  const changed = rewriteSourceLiterals(ts, source, file, mobileRenames, { inventory })
  assert.equal(changed.text, source)
  assert.match(changed.warnings.join("\n"), /keep apps\/mobile\/src\/connection\/catalog-store\.ts/)
  const kept = rewriteSourceLiterals(ts, source, file, mobileRenames.slice(1), { inventory })
  assert.equal(kept.edits.length, 1, JSON.stringify(kept.warnings))
})

test("t3code source-discovery corpus preserves selected module identities", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-source-discovery-regex.json", import.meta.url), "utf8"))
  const result = rewriteSourceLiterals(ts, corpus.source, corpus.file, corpus.renames, { inventory: corpus.inventory })
  assert.equal(result.edits.length, 1)
  assert.ok(result.selectorChecks.every(check => check.pass))
  assert.match(result.text, /vibe/)
})

// RD-022, detail 272: "No other assertion, embedded config, setup or build call
// may change." A selected-set proof alone cannot protect other uses of R.
const sharedFile = "apps/web/src/shared.test.ts"
const sharedPrefix = 'import * as fs from "node:fs";\nimport assert from "node:assert/strict";\nconst R = /\\.ts$/;\n'
const discovery = 'const files = fs.readdirSync("src").filter(file => R.test(file));\n'
const forceShared = source => source.replace("/\\.ts$/", widenExtensionRegex("/\\.ts$/"))
const rewriteShared = source => rewriteSourceLiterals(ts, source, sharedFile, webRenames, { inventory })

test("RD-022: a named regex used only for directory selection may widen", () => {
  const source = sharedPrefix + discovery + 'assert.equal(files.length, 1);\n'
  const changed = rewriteShared(source)
  assert.equal(changed.text, forceShared(source))
  assert.equal(verify(webRenames, sharedFile, source, changed.text).ok, true)
})

const unsafeSharedSources = [
  sharedPrefix + discovery + 'assert.equal(R.test("unrelated.vibe"), false);\n',
  sharedPrefix + 'fs.readdirSync("src");\nassert.equal(R.test("unrelated.vibe"), false);\n',
  sharedPrefix + discovery + 'const accepted = R.test("unrelated.vibe"); assert.equal(accepted, false);\n',
  sharedPrefix + discovery + 'export { R };\n',
  sharedPrefix.replace("const R =", "export const R =") + discovery,
  sharedPrefix + discovery + 'const object = { R }; assert.equal(object.R.test("unrelated.vibe"), false);\n',
  sharedPrefix + discovery + 'const check = R; assert.equal(check.test("unrelated.vibe"), false);\n',
  sharedPrefix + discovery + 'const f = file => R.test(file); assert.equal(f("unrelated.vibe"), false);\n',
  sharedPrefix + 'fs.readdirSync("src"); const files = ["unrelated.vibe"].filter(file => R.test(file));\n',
  sharedPrefix + 'fs.readdirSync("src"); const files = other.filter(file => R.test(file));\n',
  sharedPrefix + 'const files = fs.readdirSync("src").filter(file => (file = "unrelated.vibe") && R.test(file));\n',
  sharedPrefix + 'const files = fs.readdirSync("src").filter(file => { assert.equal(R.test(file), true); return true });\n',
]

test("RD-022: the codemod refuses shared assertions and unrelated listings", () => {
  for (const source of unsafeSharedSources) {
    const changed = rewriteShared(source)
    assert.equal(changed.text, source, source)
    assert.match(changed.warnings.join("\n"), /selection|selector/, source)
  }
})

test("RD-022: verify independently refuses forced shared-regex edits", () => {
  for (const source of unsafeSharedSources) {
    const result = verify(webRenames, sharedFile, source, forceShared(source))
    assert.equal(result.ok, false, JSON.stringify(result))
  }
})

test("RD-022: inline directory regex still widens", () => {
  const source = sharedPrefix.replace('const R = /\\.ts$/;\n', "") + discovery.replace("R.test", "/\\.ts$/.test")
  const changed = rewriteShared(source)
  assert.equal(changed.text, forceShared(source))
  assert.equal(verify(webRenames, sharedFile, source, changed.text).ok, true)
})

test("RD-022: resolved shadowed names do not hide a shared assertion", () => {
  const source = sharedPrefix + discovery + 'function probe(R) { return R.test("other") }\nassert.equal(R.test("unrelated.vibe"), false);\n'
  assert.equal(rewriteShared(source).text, source)
  assert.equal(verify(webRenames, sharedFile, source, forceShared(source)).ok, false)
})

test("RD-022 property: random uses of a named regex never change assertion behaviour", () => {
  const uses = [
    discovery,
    'const others = fs.readdirSync("src").map(String).filter(name => (R).test(name));\n',
    'assert.equal(R.test("unrelated.vibe"), false);\n',
    'const value = R.test("unrelated.vibe"); assert.equal(value, false);\n',
    'const check = R; assert.equal(check.test("unrelated.vibe"), false);\n',
    'const names = ["unrelated.vibe"].filter(name => R.test(name)); assert.equal(names.length, 0);\n',
    'const check = () => R.test("unrelated.vibe"); assert.equal(check(), false);\n',
    'const names = fs.readdirSync("src").filter(name => { assert.equal(R.test("unrelated.vibe"), false); return true });\n',
  ]
  const run = source => {
    const body = source.replace(/^import .*;\n/gm, "")
    const outcomes = []
    const assertion = { equal: (actual, expected) => outcomes.push(actual === expected) }
    Function("fs", "assert", body)({ readdirSync: () => ["module.ts"] }, assertion)
    return outcomes
  }
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: uses.length - 1 }), { minLength: 1, maxLength: 8 }), picks => {
    const source = sharedPrefix + 'fs.readdirSync("src");\n' + picks.map(i => "{\n" + uses[i] + "}\n").join("")
    const changed = rewriteShared(source)
    assert.deepEqual(run(changed.text), run(source))
    const unsafe = picks.some(i => i >= 2)
    const forced = verify(webRenames, sharedFile, source, forceShared(source))
    assert.equal(forced.ok, !unsafe, JSON.stringify(forced))
    assert.equal(changed.edits.length > 0, !unsafe)
  }), { seed: 220272, numRuns: 300 })
})

test("RD-022: named selection preserves resolved imports, parentheses and immutable lists", () => {
  for (const source of [
    sharedPrefix + 'const names = fs.readdirSync("src"); const files = names.filter(name => R.test(name));',
    sharedPrefix + 'const files = fs.readdirSync("src").map(String).filter(name => { return (R).test(name) && !name.endsWith(".json") });',
    sharedPrefix + discovery + 'function probe(R) { return R.test("other") }',
    sharedPrefix + discovery + 'const more = fs.readdirSync("src").filter(name => R.test(name));',
  ]) {
    const changed = rewriteShared(source)
    assert.equal(changed.text, forceShared(source), JSON.stringify(changed))
    assert.equal(verify(webRenames, sharedFile, source, changed.text).ok, true)
  }
})

test("RD-022 witness: a forced widening changes a real passing Node assertion", () => {
  const scratch = mkdtempSync(join(tmpdir(), "shared-regex-runtime-"))
  try {
    mkdirSync(join(scratch, "src"))
    writeFileSync(join(scratch, "src/module.ts"), "")
    const source = sharedPrefix + discovery + 'assert.equal(files.length, 1); assert.equal(R.test("unrelated.vibe"), false);'
    const run = text => {
      writeFileSync(join(scratch, "probe.mjs"), text)
      return spawnSync(process.execPath, ["probe.mjs"], { cwd: scratch, encoding: "utf8" })
    }
    assert.equal(run(source).status, 0)
    const file = "test/discovery.test.mjs"
    const renames = [{ from: "src/module.ts", to: "src/module.vibe" }]
    const inventory = ["package.json", file, "src/module.ts"]
    const changed = rewriteSourceLiterals(ts, source, file, renames, { inventory })
    assert.equal(changed.text, source)
    assert.equal(run(changed.text).status, 0)
    renameSync(join(scratch, "src/module.ts"), join(scratch, "src/module.vibe"))
    writeFileSync(join(scratch, "src/module.d.vibe.ts"), "")
    const forced = run(forceShared(source))
    assert.equal(forced.status, 1)
    assert.match(forced.stderr, /true !== false/)
    const result = verifyTestDiff({
      ts, renames, scratch,
      before: { "package.json": "{}", [file]: source, "src/module.ts": "" },
      after: { "package.json": "{}", [file]: forceShared(source), "src/module.vibe": "", "src/module.d.vibe.ts": "" },
    })
    assert.equal(result.ok, false, JSON.stringify(result))
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})
