// VIP-39: a JSX module crosses every batch gate as its TypeScript twin does.
// Each test runs both kinds, so the .ts row is the control for the .tsx row.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { rewriteBuildEntrypoints, restoreBuildEntrypoints } from "../lib/build-entrypoints.mjs"
import { convertedModules } from "../lib/converted-paths.mjs"
import { compareDistLists } from "../lib/dist-list.mjs"
import { hasVibeSource } from "../lib/emitted-exports.mjs"
import { followLintRenames } from "../lib/lint-paths.mjs"
import { pathReadDeferrals, restoreReferences, rewriteReferences } from "../lib/references.mjs"
import { regexIdentity, widenExtensionRegex } from "../lib/regex-selectors.mjs"
import { removeSupersededSidecars } from "../lib/sidecar-config.mjs"
import { pairedSidecar, verifyTestDiff } from "../lib/test-diff.mjs"
import { eslintScriptReadsVibe } from "../lib/tooling.mjs"
import { foreignChanges } from "../lib/touched.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const kinds = [{ source: ".ts", native: ".vibe" }, { source: ".tsx", native: ".vibex" }]
const put = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
const inRepository = body => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vibex-gates-"))
  try { return body(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const { source, native } of kinds) {
  const from = "src/Card" + source, to = "src/Card" + native, sidecar = "src/Card.d" + native + ".ts"

  test(`a batch owns the ${native} rename, its sidecar and its script edit`, () => {
    const batch = {
      files: [{ planned: from, path: to, migrated: true }],
      codemod: {
        importEdits: [{ file: "src/user" + native, from: "./Card", to: "./Card.js" }],
        packageScriptEdits: [{ manifest: "package.json", script: "render", module: to }]
      },
      manifestSnapshots: { "package.json": { before: JSON.stringify({ scripts: { render: "node " + from } }), after: JSON.stringify({ scripts: { render: "node " + to } }) } }
    }
    const changed = [
      { status: "R", path: to, from }, { status: "A", path: sidecar },
      { status: "M", path: "src/user" + native }, { status: "A", path: "src/user.d" + native + ".ts" },
      { status: "M", path: "package.json" }
    ]
    assert.deepEqual(foreignChanges(changed, batch), [])
  })

  test(`superseded ${native} sidecars go and the module stays`, () => inRepository(root => {
    put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx", rootDir: "src" }, vibe: { sidecarDir: "types" }, include: ["src/**/*"] }))
    put(root, to, "export const Card = 1\n")
    put(root, sidecar, "export declare const Card: 1;\n")
    assert.deepEqual(removeSupersededSidecars(root, [to, sidecar], ["tsconfig.json"], ts), [sidecar])
    assert.equal(existsSync(join(root, to)), true)
    assert.equal(existsSync(join(root, sidecar)), false)
  }))

  test(`a shipped ${source} copy that became ${native} is a move, not a loss`, () => {
    const diff = compareDistLists({ files: ["dist/Card" + source] }, { files: ["dist/Card" + native] }, [{ from, to }])
    assert.deepEqual(diff.refusals, [])
    assert.deepEqual(diff.renamedSources, [{ from: "dist/Card" + source, to: "dist/Card" + native }])
  })

  test(`a lint override follows ${from} to ${to} and back`, () => inRepository(root => {
    const config = ".oxlintrc.json"
    put(root, config, JSON.stringify({ overrides: [{ files: [from], rules: {} }] }))
    put(root, to, "export const Card = 1\n")
    assert.deepEqual(followLintRenames(root, [config, to]).map(edit => [edit.from, edit.to]), [[from, to]])
    assert.match(readFileSync(join(root, config), "utf8"), new RegExp(to.replace(".", "\\.") + '"'))
    rmSync(join(root, to))
    put(root, from, "export const Card = 1\n")
    assert.deepEqual(followLintRenames(root, [config, from]).map(edit => [edit.from, edit.to]), [[to, from]])
  }))

  test(`a tree that holds ${to} alone has converted it`, () => {
    const converted = convertedModules([to])
    assert.ok(converted.some(move => move.from === from && move.to === to), JSON.stringify(converted))
    assert.deepEqual(convertedModules([to, from]), [])
  })

  test(`a path read of ${from} follows the rename and comes back`, () => inRepository(root => {
    const text = 'const url = new URL("Card' + source + '", import.meta.url)\n'
    put(root, "package.json", "{}")
    put(root, to, "export const Card = 1\n")
    put(root, "src/paths.ts", text)
    const edits = rewriteReferences(root, [{ from, to }], [to, "src/paths.ts"])
    assert.equal(readFileSync(join(root, "src/paths.ts"), "utf8"), text.replace(source, native))
    restoreReferences(root, edits, from)
    assert.equal(readFileSync(join(root, "src/paths.ts"), "utf8"), text)
  }))

  test(`a shell path to ${from} follows the rename and comes back`, () => inRepository(root => {
    const text = "#!/bin/sh\nnode " + from + "\n"
    put(root, "package.json", "{}")
    put(root, to, "export const Card = 1\n")
    put(root, "run.sh", text)
    const edits = rewriteReferences(root, [{ from, to }], [to, "run.sh"])
    assert.equal(readFileSync(join(root, "run.sh"), "utf8"), text.replace(from, to))
    restoreReferences(root, edits, from)
    assert.equal(readFileSync(join(root, "run.sh"), "utf8"), text)
  }))

  test(`a test that reads ${from} as text keeps it TypeScript`, () => inRepository(root => {
    const test = "tests/read.test.ts"
    put(root, "package.json", "{}")
    put(root, from, "export const Card = 1\n")
    put(root, test, 'readFileSync(new URL("../src/Card' + source + '", import.meta.url), "utf8")\n')
    assert.deepEqual(pathReadDeferrals(root, [from], [from, test]).map(cause => cause.file), [from])
  }))

  test(`a build input ${from} follows the rename and comes back`, () => inRepository(root => {
    const file = "vite.config.ts", text = 'export default { build: { lib: { entry: "./' + from + '" } } }\n'
    put(root, "package.json", "{}")
    put(root, file, text)
    put(root, to, "export const Card = 1\n")
    const result = rewriteBuildEntrypoints(root, [file], [{ from, to }], ts)
    assert.deepEqual(result.warnings, [])
    assert.equal(readFileSync(join(root, file), "utf8"), text.replace(from, to))
    assert.equal(restoreBuildEntrypoints(root, result.edits, from, ts).length, 1)
    assert.equal(readFileSync(join(root, file), "utf8"), text)
  }))

  test(`a file selector written for ${source} still selects ${native} and no sidecar`, () => {
    const before = "/\\.tsx?$/", after = widenExtensionRegex(before)
    const compiled = new RegExp(after.slice(1, after.lastIndexOf("/")))
    assert.equal(compiled.test(to), true)
    assert.equal(compiled.test(sidecar), false)
    assert.equal(regexIdentity(before, after, [from], [to], [{ from, to }]).pass, true)
  })

  test(`a ${native} module marks its package and its test does not`, () => inRepository(root => {
    put(root, "src/Card.test" + native, "export {}\n")
    assert.equal(hasVibeSource(root), false)
    put(root, to, "export const Card = 1\n")
    assert.equal(hasVibeSource(root), true)
  }))

  test(`a sidecar pairs with its ${native} module`, () => {
    assert.equal(pairedSidecar(sidecar, { [to]: "" }), true)
    assert.equal(pairedSidecar(sidecar, {}), false)
  })
}

test("a lint script's glob gains the native twin of each kind it names", () => {
  assert.equal(eslintScriptReadsVibe("eslint 'src/**/*.tsx'"), "eslint 'src/**/*.tsx' 'src/**/*.vibex' --no-error-on-unmatched-pattern")
  assert.equal(eslintScriptReadsVibe("eslint 'src/**/*.ts'"), "eslint 'src/**/*.ts' 'src/**/*.vibe' --no-error-on-unmatched-pattern")
})

test("a .vibe-only widening upgrades once, and only where it admits .tsx", () => {
  const earlier = "/(?<!\\.d\\.vibe)\\.(?:tsx?|vibe)$/", next = "/(?<!\\.d\\.vibex?)\\.(?:tsx?|vibex?)$/"
  assert.equal(widenExtensionRegex(earlier), next)
  assert.equal(widenExtensionRegex(next), null)
  assert.equal(widenExtensionRegex("/(?<!\\.d\\.vibe)\\.(?:ts|vibe)$/"), null)
  const before = ["src/a.vibe", "src/a.d.vibe.ts", "src/Card.tsx"]
  const after = ["src/a.vibe", "src/a.d.vibe.ts", "src/Card.vibex", "src/Card.d.vibex.ts"]
  assert.equal(regexIdentity(earlier, next, before, after, [{ from: "src/Card.tsx", to: "src/Card.vibex" }]).pass, true)
})

test("a test's selector owes an exclusion only for the sidecars its batch writes", () => inRepository(scratch => {
  const selector = body => 'const files = readdirSync("src").filter(n => ' + body + ');\n'
  const widenedForVibe = '(n.endsWith(".ts") || n.endsWith(".vibe")) && !n.endsWith(".d.vibe.ts")'
  const check = (from, to, after) => verifyTestDiff({
    ts, scratch,
    before: { "package.json": "{}", [from]: "", "test/x.test.ts": selector('n.endsWith(".ts")') },
    after: { "package.json": "{}", [to]: "", "test/x.test.ts": selector(after) },
    renames: [{ from, to }]
  }).ok
  assert.equal(check("src/X.ts", "src/X.vibe", widenedForVibe), true)
  assert.equal(check("src/X.tsx", "src/X.vibex", widenedForVibe), false)
}))

test("a selector that reaches a JSX sidecar fails identity by name", () => {
  const widened = "/\\.(?:tsx?|vibex?)$/"
  const identity = regexIdentity("/\\.tsx?$/", widened, ["src/Card.tsx"], ["src/Card.vibex", "src/Card.d.vibex.ts"], [{ from: "src/Card.tsx", to: "src/Card.vibex" }])
  assert.equal(identity.pass, false)
})
