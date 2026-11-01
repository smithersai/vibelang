// foldkit-107: `.oxlintrc.effect.json` turned a rule off for x.ts, the rename
// made it x.vibe, and the override stopped matching. Each test here asks the
// question the ruling asks: is what was silenced on x.ts silenced on x.vibe?
import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { renameBatch } from "../lib/codemod.mjs"
import * as Jj from "../lib/jj.mjs"
import { followLintRenames, lintConfigs, stringsOf } from "../lib/lint-paths.mjs"
import { codemod, makeConfig, paths, revert, wireTarget } from "../lib/steps.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-lint-override-rename.json", import.meta.url), "utf8"))
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")

const put = (root, file, text) => {
  mkdirSync(posix.dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
const fresh = (body) => async (...args) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-lint-paths-"))
  try {
    return await body(root, ...args)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
const repository = async (root) => {
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
}
const jsonc = (text) => JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/g, (all, string) => string ?? "").replace(/,(\s*[}\]])/g, "$1"))

// Native `vibelang lint`'s reading of a glob (effecttsgo/lint/config.go, globRegexp), kept apart from
// the implementation, which matches with posix.matchesGlob. The two agreeing is part of the property.
function nativeGlob(glob) {
  glob = glob.replace(/^\.\//, "")
  const anchored = glob.replace(/\/$/, "").includes("/")
  glob = glob.replace(/^\//, "")
  let out = anchored ? "^" : "(?:^|.*/)"
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === "*" && glob[i + 1] === "*") {
      i++
      if (glob[i + 1] === "/") { i++; out += "(?:.*/)?" } else out += ".*"
    } else if (char === "*") out += "[^/]*"
    else if (char === "?") out += "[^/]"
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(out + (glob.endsWith("/") ? ".*" : "(?:/.*)?") + "$")
}
const silenced = (config, file) => jsonc(config).overrides.some((o) => o.files.some((glob) => nativeGlob(glob).test(file)))

test("foldkit-107: a rule silenced on x.ts stays silenced on x.vibe, comments and untouched paths intact", fresh(async (root) => {
  assert.ok(contract.includes("so a rule silenced on `x.ts` stays silenced on `x.vibe`"), "update the quoted contract")
  put(root, corpus.config, corpus.text)
  for (const file of [...corpus.renamed, ...corpus.stays]) put(root, file, "export const a = 1\n")
  const tracked = [corpus.config, ...corpus.stays, ...renameBatch(root, corpus.renamed).map((rename) => rename.to)]
  for (const file of corpus.renamed) assert.ok(!silenced(corpus.text, file.replace(/\.ts$/, ".vibe")), `${file}: the override was already dead`)

  const edits = followLintRenames(root, tracked)
  const after = readFileSync(join(root, corpus.config), "utf8")
  assert.equal(edits.length, corpus.renamed.length)
  for (const file of corpus.renamed) assert.ok(silenced(after, file.replace(/\.ts$/, ".vibe")), file)
  for (const file of corpus.stays) assert.ok(silenced(after, file), file)
  assert.ok(after.includes("// Plumbing whose failure channel is public `unknown`."))
  assert.equal(after.replace(/\.vibe"/g, '.ts"'), corpus.text)
  assert.deepEqual(followLintRenames(root, tracked), [], "a second pass finds nothing")
}))

test("alchemy's oxlint.config.ts and Smithers' eslint.config.js keep their shapes", fresh(async (root) => {
  put(root, "oxlint.config.ts", `import { defineConfig } from "oxlint"\nexport default defineConfig({\n  ignorePatterns: ["packages/alchemy/src/Gen.ts", "**/*.test.ts"],\n  rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },\n})\n`)
  // Smithers holds the path in a constant that a config object spreads, so the property's name does not say what it is.
  put(root, "eslint.config.js", `const generated = ["packages/smithers/src/internal/backend/ProductApi.ts"]\nconst sources = ["packages/*/src/**/*.ts"]\nexport default [{ ignores: [...generated] }, { files: sources }]\n`)
  put(root, "packages/smithers/eslint.config.js", `export default [{ ignores: ["src/internal/backend/ProductApi.ts"] }]\n`)
  put(root, "packages/alchemy/src/Gen.vibe", "export const a = 1\n")
  put(root, "packages/smithers/src/internal/backend/ProductApi.vibe", "export const a = 1\n")
  const tracked = ["oxlint.config.ts", "eslint.config.js", "packages/smithers/eslint.config.js", "packages/alchemy/src/Gen.vibe", "packages/smithers/src/internal/backend/ProductApi.vibe"]
  assert.equal(followLintRenames(root, tracked).length, 3)
  assert.match(readFileSync(join(root, "oxlint.config.ts"), "utf8"), /\["packages\/alchemy\/src\/Gen\.vibe", "\*\*\/\*\.test\.ts"\]/)
  assert.match(readFileSync(join(root, "eslint.config.js"), "utf8"), /const generated = \["packages\/smithers\/src\/internal\/backend\/ProductApi\.vibe"\]/)
  assert.match(readFileSync(join(root, "eslint.config.js"), "utf8"), /const sources = \["packages\/\*\/src\/\*\*\/\*\.ts"\]/, "an ESLint glob stays: the repository's parsers do not read .vibe")
  assert.match(readFileSync(join(root, "packages/smithers/eslint.config.js"), "utf8"), /"src\/internal\/backend\/ProductApi\.vibe"/, "a package's config names paths from its own directory")
}))

test("an Oxlint glob gains the .vibe spelling only where a module moved under it", fresh(async (root) => {
  put(root, ".oxlintrc.json", JSON.stringify({ overrides: [
    { files: ["packages/a/src/**/*.ts"], rules: {} },
    { files: ["packages/b/src/**/*.ts"], rules: {} },
    { files: ["entry.ts"], rules: {} }
  ], ignorePatterns: ["!packages/a/src/keep/*.ts"] }))
  put(root, "packages/a/src/x.vibe", "")
  put(root, "packages/a/src/keep/y.vibe", "")
  put(root, "packages/b/src/x.ts", "")
  put(root, "nested/entry.vibe", "")
  const tracked = [".oxlintrc.json", "packages/a/src/x.vibe", "packages/a/src/keep/y.vibe", "packages/b/src/x.ts", "nested/entry.vibe"]
  followLintRenames(root, tracked)
  const config = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8"))
  assert.deepEqual(config.overrides.map((o) => o.files), [["packages/a/src/**/*.ts", "packages/a/src/**/*.vibe"], ["packages/b/src/**/*.ts"], ["entry.ts"]])
  assert.deepEqual(config.ignorePatterns, ["!packages/a/src/keep/*.ts", "!packages/a/src/keep/*.vibe"])
  assert.deepEqual(followLintRenames(root, tracked), [])
}))

test("a split module's path also names its platform sibling, and revert takes both back", fresh(async (root) => {
  const target = join(root, "repo"), run = join(root, "run")
  const original = JSON.stringify({ overrides: [{ files: ["src/b.ts", "src/c.ts"], rules: {} }] }) + "\n"
  mkdirSync(target)
  await repository(target)
  put(target, "package.json", "{}\n")
  put(target, ".oxlintrc.effect.json", original)
  put(target, "src/b.ts", "export const b = 1\n")
  put(target, "src/c.ts", "export const c = 1\n")
  await Jj.commit(target, "base")
  writeJson(paths(run).config, makeConfig({ target, test: "true", toolchain: join(root, "toolchain") }))
  writeJson(paths(run).plan, { batches: [{ files: ["src/b.ts", "src/c.ts"] }] })
  const renames = renameBatch(target, ["src/b.ts", "src/c.ts"])
  put(target, "src/b.platform.ts", "export const raw = 1\n")
  followLintRenames(target, await Jj.trackedFiles(target))
  assert.deepEqual(JSON.parse(readFileSync(join(target, ".oxlintrc.effect.json"), "utf8")).overrides[0].files, ["src/b.vibe", "src/b.platform.ts", "src/c.vibe"])
  writeJson(paths(run).codemod("01"), { renames, exportEdits: [], importEdits: [], platform: { splits: [{ file: "src/b.ts", platform: "src/b.platform.ts" }] } })
  const reverted = await revert({ run, batch: "01", file: "src/b.vibe", reason: "blocked on an issue" })
  assert.ok(!existsSync(join(target, "src/b.platform.ts")))
  assert.deepEqual(JSON.parse(readFileSync(join(target, ".oxlintrc.effect.json"), "utf8")).overrides[0].files, ["src/b.ts", "src/c.vibe"])
  assert.deepEqual(reverted.lintPaths.map((edit) => edit.to), ["src/b.ts", null])
}))

test("the codemod step points the configuration at the batch", fresh(async (root) => {
  const target = join(root, "repo"), run = join(root, "run")
  mkdirSync(target)
  await repository(target)
  put(target, "package.json", "{}\n")
  put(target, ".oxlintrc.effect.json", '{ "overrides": [{ "files": ["src/b.ts"], "rules": {} }] }\n')
  put(target, "src/b.ts", "export const b = 1\n")
  await Jj.commit(target, "base")
  mkdirSync(join(target, "node_modules"))
  symlinkSync(join(runtime, "node_modules/typescript"), join(target, "node_modules/typescript"))
  // The batch sits in no listed package, so the step renames and rewrites and runs no compiler
  // beyond the function-model probe, which the listed package's fake answers.
  writeProbeAwareCompiler(join(target, "elsewhere/node_modules/.bin/vibelang"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  const config = { ...makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }), packages: [{ dir: "elsewhere", tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json", sources: ["src"] }] }
  writeJson(paths(run).config, config)
  writeJson(paths(run).plan, { batches: [{ files: ["src/b.ts"] }] })
  mkdirSync(paths(run).batch("01"), { recursive: true })
  const result = await codemod({ run, batch: "01" })
  assert.deepEqual(result.lintPaths, [{ config: ".oxlintrc.effect.json", from: "src/b.ts", to: "src/b.vibe" }])
}))

test("setup repairs a path an earlier run's rename left behind", fresh(async (root) => {
  put(root, "package.json", JSON.stringify({ name: "fixture", private: true }, null, 2) + "\n")
  put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }, null, 2) + "\n")
  put(root, ".oxlintrc.effect.json", '{ "overrides": [{ "files": ["src/landed.ts"], "rules": {} }] }\n')
  put(root, "src/landed.vibe", "export const a = 1\n")
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
  await repository(root)
  const config = makeConfig({ target: root, test: "true", vibelangVersion: "0.0.11", install: "true" })
  const wired = await wireTarget(config, join(root, ".logs"))
  assert.ok(wired.changed.includes(".oxlintrc.effect.json"), wired.changed.join("\n"))
  assert.match(readFileSync(join(root, ".oxlintrc.effect.json"), "utf8"), /"src\/landed\.vibe"/)
}))

test("a config is a configuration file, not its test or generated copy", () => {
  assert.deepEqual(lintConfigs([".oxlintrc.json", ".oxlintrc.effect.json", "oxlint.config.ts", "packages/a/eslint.config.mjs", "eslint.package.js", "eslint.jsdoc.test.mjs", ".vibelang/eslint.config.mjs", "src/oxlintrc.ts", ".eslintrc.cjs", "tsconfig.json"]),
    [".oxlintrc.json", ".oxlintrc.effect.json", "oxlint.config.ts", "packages/a/eslint.config.mjs", "eslint.package.js", ".eslintrc.cjs"])
})

test("the scan reads comments, keys, escapes and regular quotes in lists as a config writes them", () => {
  const strings = stringsOf(`{ "files": ["a.ts", 'b.ts', \`c.ts\`], /* "d.ts" */ "e.ts": 1, // "f.ts"\n x: "g\\".ts" }`)
  assert.deepEqual(strings.map((s) => s.value), ["files", "a.ts", "b.ts", "c.ts", 'g\\".ts'].filter((value) => value !== "files"))
  assert.equal(new Set(strings.slice(0, 3).map((s) => s.list)).size, 1)
  assert.equal(strings[3].list, null)
})

const segment = fc.constantFrom("src", "lib", "runtime", "command", "index", "a-b", "x_y", "with space", "café")
const relative = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join("/"))
const spelling = fc.constantFrom("", "./")

test("property: whatever an override silenced stays silenced after any rename, in any repository layout", () => {
  fc.assert(fc.property(
    fc.uniqueArray(relative, { minLength: 1, maxLength: 8 }), fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    spelling, fc.constantFrom("", "packages/app"), fc.constantFrom(".oxlintrc.json", ".oxlintrc.effect.json", ".oxlintrc.app.jsonc"), fc.boolean(),
    (names, moved, lead, dir, name, trailing) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-lint-paths-"))
      try {
        const modules = names.map((path, i) => ({ ts: posix.join(dir, path + ".m.ts"), rel: path + ".m.ts", moved: moved[i] }))
        const list = modules.map((m) => JSON.stringify(lead + m.rel)).join(", ")
        const config = posix.join(dir, name)
        const text = `{\n  // Silenced on purpose.\n  "overrides": [{ "files": [${list}${trailing ? "," : ""}], "rules": { "a/b": "off" } }],\n}\n`
        put(root, config, text)
        for (const m of modules) put(root, m.moved ? m.ts.slice(0, -3) + ".vibe" : m.ts, "")
        const tracked = [config, ...modules.map((m) => m.moved ? m.ts.slice(0, -3) + ".vibe" : m.ts)]
        followLintRenames(root, tracked)
        const after = readFileSync(join(root, config), "utf8")
        for (const m of modules) {
          const now = (m.moved ? m.rel.slice(0, -3) + ".vibe" : m.rel)
          assert.ok(silenced(after, now), `${now} is no longer silenced:\n${after}`)
        }
        assert.ok(after.includes("// Silenced on purpose."))
        assert.deepEqual(followLintRenames(root, tracked), [], "the pass is idempotent")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }), { numRuns: 200 })
})

test("property: revert undoes the pass, byte for byte", () => {
  fc.assert(fc.property(fc.uniqueArray(relative, { minLength: 1, maxLength: 6 }), fc.boolean(), (names, single) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-lint-paths-"))
    try {
      const files = names.map((name) => name + ".m.ts")
      const quote = single ? "'" : '"'
      const text = `export default [{ ignores: [${files.map((f) => quote + f + quote).join(", ")}] }]\n`
      put(root, "eslint.config.mjs", text)
      for (const file of files) put(root, file, "")
      const tracked = ["eslint.config.mjs", ...files]
      for (const { from, to } of renameBatch(root, files)) tracked[tracked.indexOf(from)] = to
      followLintRenames(root, tracked)
      assert.notEqual(readFileSync(join(root, "eslint.config.mjs"), "utf8"), text)
      for (const file of files) renameSync(join(root, file.slice(0, -3) + ".vibe"), join(root, file))
      followLintRenames(root, ["eslint.config.mjs", ...files])
      assert.equal(readFileSync(join(root, "eslint.config.mjs"), "utf8"), text)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { numRuns: 100 })
})

test("property: the glob reader the pass relies on agrees with native vibelang lint", () => {
  const glob = fc.tuple(fc.constantFrom("", "packages/", "packages/*/", "**/"), fc.constantFrom("*.vibe", "**/*.vibe", "index.*.vibe", "x?.vibe"))
    .map(([prefix, name]) => prefix + name)
  const file = fc.tuple(fc.constantFrom("", "packages/", "packages/a/", "packages/a/src/"), fc.constantFrom("index.m.vibe", "x1.vibe", "y.vibe")).map(([prefix, name]) => prefix + name)
  fc.assert(fc.property(glob, file, (pattern, path) => {
    const anyDepth = pattern.includes("/") ? pattern : "**/" + pattern
    assert.equal(posix.matchesGlob(path, anyDepth), nativeGlob(pattern).test(path), `${pattern} on ${path}`)
  }), { numRuns: 300 })
})
