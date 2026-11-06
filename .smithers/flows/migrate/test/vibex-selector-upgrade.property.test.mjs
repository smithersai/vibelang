import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { regexIdentity, widenExtensionRegex } from "../lib/regex-selectors.mjs"
import { verifyTestDiff } from "../lib/test-diff.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-previously-widened-vibex-selector.json", import.meta.url), "utf8"))
const groups = ["tsx?", "(ts|tsx)", "(?:ts|tsx)", "m?tsx?", "[cm]?tsx?", "[mc]?tsx?"]
const compile = text => new RegExp(text.slice(1, text.lastIndexOf("/")), text.slice(text.lastIndexOf("/") + 1))
const selected = (text, paths) => paths.filter(path => compile(text).test(path)).sort()

test("selector upgrades quote preservation and the JSX file-kind rule", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
  assert.ok(readFileSync(SpecPath("../vips/0039-vibex.md"), "utf8").includes(corpus.jsxQuote))
})

function checkUpgrade(shape) {
  const directory = "src/" + shape.folders.join("/")
  const prefix = directory.replace(/\/$/, "") + "/"
  const from = prefix + shape.stem + ".tsx", to = prefix + shape.stem + ".vibex"
  const prior = prefix + "prior.vibe", oldSidecar = prefix + "prior.d.vibe.ts", sidecar = prefix + shape.stem + ".d.vibex.ts"
  const retained = [prefix + "kept.ts", prefix + "peer.js", prefix + "data.json"]
  const before = [prior, oldSidecar, from, ...retained], after = [prior, oldSidecar, to, sidecar, ...retained]
  const earlier = shape.earlier ?? "/(?<!\\.d\\.vibe)\\.(?:" + shape.group + "|vibe)$/" + shape.flags
  const next = widenExtensionRegex(earlier)
  assert.equal(typeof next, "string", earlier)
  // The oracle is the selected original modules with exactly the written rename.
  const expected = selected(earlier, before).map(path => path === from ? to : path).sort()
  assert.deepEqual(selected(next, after), expected)
  assert.equal(regexIdentity(earlier, next, before, after, [{ from, to }]).pass, true)
  assert.equal(widenExtensionRegex(next), null)
  assert.equal(widenExtensionRegex("/(?<!\\.d\\.vibe)\\.(?:ts|vibe)$/" + shape.flags), null)
  assert.equal(regexIdentity(earlier, earlier, before, after, [{ from, to }]).pass, false)
  const loose = "/\\.(?:" + shape.group + "|vibex?)$/" + shape.flags
  assert.equal(regexIdentity(earlier, loose, before, after, [{ from, to }]).pass, false)
  const extra = "/(?<!\\.d\\.vibex?)\\.(?:" + shape.group + "|vibex?|js)$/" + shape.flags
  assert.equal(regexIdentity(earlier, extra, before, after, [{ from, to }]).pass, false)
}

function checkGate(shape) {
  const scratch = mkdtempSync(join(tmpdir(), "selector-sidecar-"))
  try {
    const name = shape.binding, path = "src/" + shape.stem
    const source = body => 'const files = readdirSync("src").filter(' + name + " => " + body + ");\n"
    const before = source(name + '.endsWith(".ts")')
    const widening = "(" + name + '.endsWith(".ts") || ' + name + '.endsWith(".vibe")) && !' + name + '.endsWith(".d.vibe.ts")'
    const check = (from, to, body) => verifyTestDiff({
      ts, scratch, before: { "package.json": "{}", [from]: "", "test/selector.test.ts": before },
      after: { "package.json": "{}", [to]: "", "test/selector.test.ts": source(body) }, renames: [{ from, to }]
    }).ok
    assert.equal(check(path + ".ts", path + ".vibe", widening), true)
    assert.equal(check(path + ".tsx", path + ".vibex", widening), false)
    assert.equal(check(path + ".ts", path + ".vibe", "(" + widening + ") || " + name + '.endsWith(".js")'), false)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}

test("the original earlier-widened T3 Code selector keeps prior modules and admits the JSX twin", () => {
  assert.ok(corpus.source.includes(corpus.earlier))
  assert.deepEqual(ts.createSourceFile("selector.ts", corpus.source, ts.ScriptTarget.Latest, true).parseDiagnostics, [])
  checkUpgrade({ ...corpus.witness, earlier: corpus.earlier })
})
test("a TypeScript-only batch keeps its own sidecar exclusion", () => checkGate({ stem: "Card", binding: "file" }))
test("property: earlier selector upgrades preserve only the mapped selected modules", () => checkProperty(fc, {
  name: corpus.key, rule: corpus.quote,
  command: "node --test .smithers/flows/migrate/test/vibex-selector-upgrade.property.test.mjs",
  numRuns: 160, arbitrary: fc.record({
    group: fc.constantFrom(...groups), flags: fc.constantFrom("", "i", "u", "iu"),
    folders: fc.array(fc.constantFrom("views", "a.b", "nested", "é"), { maxLength: 4 }),
    stem: fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/)
  }), check: checkUpgrade
}))
test("property: sidecar obligations follow the batch's actual file kind", () => checkProperty(fc, {
  name: corpus.key + "-gate", rule: corpus.quote,
  command: "node --test .smithers/flows/migrate/test/vibex-selector-upgrade.property.test.mjs",
  numRuns: 80, arbitrary: fc.record({
    stem: fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/), binding: fc.constantFrom("file", "entry", "name")
  }), check: checkGate
}))
