import { assertReleasePublication } from "./release-publication-checks.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { coverage, targetRelease } from "./release-note-coverage-fixtures.mjs"
const root = fileURLToPath(new URL("../../", import.meta.url))
const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const version = JSON.parse(readFileSync(join(root, "packages/compiler/package.json"), "utf8")).version
const final = Boolean(process.env.VIBELANG_RELEASE_NOTES_FINAL)
const activeRelease = final && version === targetRelease
const normalize = text => text.replaceAll("`", "").replace(/\s+/g, " ").toLowerCase()
function releaseSections() {
  return readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8").split(/^## /m).slice(1)
}
function release11() {
  const found = releaseSections().filter(section => section.split("\n")[0].replace(/ \(unreleased\)$/, "") === targetRelease)
  assert.equal(found.length, 1, "keep one source section for the release whose fixes these tests record")
  return found[0]
}
for (const entry of coverage) test("release 0.0.11 records the public fix: " + entry.key, { skip: !final }, () => {
  const rows = release11().match(/^- .*(?:\n(?!\n|[-*] |#{1,6} ).+)*/gm) || []
  assert.equal(rows.filter(row => entry.needles.every(needle => normalize(row).includes(needle))).length, 1, entry.key)
})
test("current publication omits the contrast helper-renderer record", { skip: !final }, () => {
  const sections = releaseSections()
  const current = sections.findIndex(section => section.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(current >= 0)
  assert.doesNotMatch(sections.slice(0, current + 1).join("\n"), /site(?:['’]s)?\s+contrast\s+check/i)
})
function compilerEnvironment() {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  env.VIBELANG_BINARY ||= join(root, "packages/compiler/native/vibelang" + (process.platform === "win32" ? ".exe" : ""))
  env.VIBELANG_RUNTIME ||= join(root, "packages/runtime")
  env.EFFECT_NODE_MODULES ||= join(root, "experiments/node_modules")
  assert.ok(existsSync(env.VIBELANG_BINARY), "the release compiler must be built before checking release claims")
  return env
}
test("known helper limits agree with released runner and matcher cases", { skip: !activeRelease }, t => {
  const env = compilerEnvironment()
  // The stock harness selects built/local/tsc; stage it in a private tree so
  // the check uses the requested release artifact and never replaces a shared compiler.
  const sandbox = mkdtempSync(join(tmpdir(), "vibelang-known-cases-"))
  let casesPassed = false
  t.after(() => {
    if (casesPassed) rmSync(sandbox, { recursive: true, force: true })
    else console.error("release-note compiler evidence retained at " + sandbox)
  })
  const tsroot = join(sandbox, "typescript")
  const inputs = join(root, "typescript/vibelang")
  const staged = join(tsroot, "vibelang")
  mkdirSync(join(staged, "cases"), { recursive: true })
  for (const name of readdirSync(inputs).filter(name => name.endsWith(".mjs"))) {
    copyFileSync(join(inputs, name), join(staged, name))
  }
  for (const name of ["entry-main-runner-names", "match-builtin-shadowed", "match-builtin-own-option", "decl-provide"]) {
    const source = join(inputs, "cases", name)
    const target = join(staged, "cases", name)
    mkdirSync(target)
    for (const child of readdirSync(source).filter(child => !["out", "node_modules"].includes(child))) {
      cpSync(join(source, child), join(target, child), { recursive: true })
    }
  }
  mkdirSync(join(tsroot, "built/local"), { recursive: true })
  const compiler = join(tsroot, "built/local/tsc")
  copyFileSync(env.VIBELANG_BINARY, compiler)
  chmodSync(compiler, 0o755)
  if (process.platform === "win32") copyFileSync(env.VIBELANG_BINARY, compiler + ".exe")
  const result = spawnSync("node", ["vibelang/harness.mjs", "--verbose", "--jobs", "2",
    "entry-main-runner-names", "match-builtin-shadowed", "match-builtin-own-option", "decl-provide"],
    { cwd: tsroot, env, encoding: "utf8", timeout: 45_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error || ""))
  for (const name of ["entry-main-runner-names", "match-builtin-shadowed", "match-builtin-own-option", "decl-provide"]) {
    assert.match(result.stdout, new RegExp("ok\\s+" + name + "\\b"))
  }
  console.log("release-note symbol cases passed using " + env.VIBELANG_BINARY)
  casesPassed = true
  const paragraph = release11().match(/^- \*\*Some (?:names|helper aliases)[\s\S]*?(?=\n\n- |\n### |$)/m)?.[0]
  assert.ok(paragraph, "retain the remaining helper-alias advice")
  assert.doesNotMatch(paragraph, /\b(?:Number|String|Option|runSync|runPromise|runMain|runFork|runCallback)\b/)
})
test("known provider limits agree with literal provider diagnostics", { skip: !activeRelease }, t => {
  const env = compilerEnvironment()
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-known-provider-")))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  mkdirSync(join(project, "node_modules"))
  symlinkSync(realpathSync(join(env.VIBELANG_RUNTIME, "node_modules/effect")), join(project, "node_modules/effect"), "dir")
  symlinkSync(env.VIBELANG_RUNTIME, join(project, "node_modules/vibelang-runtime"), "dir")
  writeFileSync(join(project, "package.json"), '{"private":true,"type":"module"}\n')
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "es2022", module: "nodenext", moduleResolution: "nodenext",
      types: [], skipLibCheck: true, noEmit: true }, include: ["main.vibe"]
  }))
  writeFileSync(join(project, "main.vibe"), "export effect function marked() {\n  provide 123 { return 1 }\n}\nexport function plain() {\n  provide 123 { return 1 }\n}\n")
  const result = spawnSync(env.VIBELANG_BINARY, ["-p", join(project, "tsconfig.json"), "--pretty", "false"],
    { cwd: root, env, encoding: "utf8", timeout: 30_000 })
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /main\.vibe\(2,\d+\): error/)
  assert.match(result.stdout, /main\.vibe\(5,\d+\): error/)
  assert.doesNotMatch(normalize(release11()), /provide accepts values that are neither layers nor contexts/)
})
function fixture(t) {
  const place = mkdtempSync(join(tmpdir(), "vibelang-note-coverage-"))
  t.after(() => rmSync(place, { recursive: true, force: true }))
  for (const file of ["docs/tools/release-docs.test.mjs", "docs/tools/release-docs.mjs", "docs/tools/release-publication-checks.mjs"]) {
    mkdirSync(dirname(join(place, file)), { recursive: true })
    copyFileSync(join(root, file), join(place, file))
  }
  const manifest = join(place, "packages/compiler/package.json")
  mkdirSync(dirname(manifest), { recursive: true })
  writeFileSync(manifest, JSON.stringify({ version: "0.0.11" }))
  const notes = join(place, "docs/user/src/setup/release-notes.md")
  mkdirSync(dirname(notes), { recursive: true })
  const retained = ["- Editor parsing rejected `for try` `Stream` loops; they now parse.",
    "- A tool that reads a `.vibe` file through the TypeScript mapper now retains its diagnostic.",
    "- The migrate flow now reads compiler output with Windows line endings."].join("\n")
  return (row, location = "bugs") => {
    writeFileSync(notes, "# Release notes\n\n## 0.0.11 (unreleased)\n\n" +
      (location === "intro" ? row + "\n\n" : "") + "### Bugs fixed since 0.0.10\n\n" +
      retained + "\n\n" + (location === "bugs" ? row + "\n" : "") +
      "\n## 0.0.10\n" + (location === "history" ? row + "\n" : ""))
    try {
      assertReleasePublication(readFileSync(notes, "utf8"), "0.0.11")
      return { failed: false, message: "" }
    } catch (error) {
      return { failed: true, message: String(error) }
    }
  }
}
test("contrast bookkeeping guard covers typography case wrapping and historical placement", t => {
  const check = fixture(t)
  fc.assert(fc.property(fc.constantFrom("site's contrast check", "site’s contrast check"),
    fc.constantFrom(" ", "  ", "\t", "\n  "), fc.boolean(), fc.constantFrom("intro", "bugs", "history"),
    (phrase, space, uppercase, location) => {
      const text = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(space)
      const result = check("- The " + text + " now avoids a helper renderer.", location)
      assert.equal(result.failed, location !== "history", result.message)
    }), { numRuns: 40, seed: 110024, examples: [["site's contrast check", " ", false, "bugs"]] })
})
test("restored product fixes remain publishable through wording changes", t => {
  const check = fixture(t)
  fc.assert(fc.property(fc.constantFrom(...coverage.map(entry => entry.note)), fc.boolean(),
    fc.constantFrom(" ", "\n  "), fc.constantFrom("intro", "bugs", "history"), (note, uppercase, space, location) => {
      const text = (uppercase ? note.toUpperCase() : note).split(" ").join(space)
      const result = check("- " + text, location)
      assert.equal(result.failed, false, result.message)
    }), { numRuns: 40, seed: 110025, examples: coverage.map(entry => [entry.note, false, " ", "bugs"]) })
})

test("release notes do not enable the retired setup sidecar setting", { skip: !final }, () => {
  assert.doesNotMatch(normalize(release11()), /setup now turns on declarationsidecars/)
})
