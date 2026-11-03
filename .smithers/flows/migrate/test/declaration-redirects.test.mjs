import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"
import { ownedTsconfigs } from "../lib/wire.mjs"
import { isProtectedFile } from "../lib/test-diff.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

test("alchemy-57: setup preserves sidecar source redirects for referenced producer and consumer projects", async () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-source-redirect-"))
  const put = (file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value)) }
  try {
    put("package.json", { private: true, workspaces: ["packages/*"] })
    put("tsconfig.base.json", { compilerOptions: { disableSourceOfProjectReferenceRedirect: true, strict: true } })
    put("tsconfig.json", { files: [], references: [{ path: "packages/p" }, { path: "packages/c" }] })
    for (const name of ["p", "c"]) {
      put("packages/" + name + "/package.json", { name: "@fixture/" + name, private: true })
      put("packages/" + name + "/tsconfig.json", { extends: "../../tsconfig.base.json", include: ["src/**/*.ts"], ...(name === "c" ? { references: [{ path: "../p" }] } : {}) })
      put("packages/" + name + "/src/main.ts", "export interface Value { readonly id: string }\n")
    }
    put("node_modules/.bin/vibelang", "#!/bin/sh\nexit 0\n")
    require("node:fs").chmodSync(join(root, "node_modules/.bin/vibelang"), 0o755)
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(root, "node_modules/typescript"))
    put(".gitignore", "node_modules/\n.logs/\n")
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m baseline", { cwd: root })
    const config = makeConfig({ target: root, packages: ["packages/p", "packages/c"], test: "true", install: "true", vibelangVersion: "0.0.11" })
    const result = await wireTarget(config, join(root, ".logs"))
    for (const name of ["p", "c"]) {
      const file = join(root, "packages/" + name + "/tsconfig.json")
      const raw = ts.readConfigFile(file, ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, dirname(file), {}, file)
      assert.equal(parsed.options.disableSourceOfProjectReferenceRedirect, false, "typed namespace consumers must use source sidecars")
    }
    assert.ok(result.declarationRedirects.edits.some(e => e.file === "tsconfig.base.json" && e.from === true && e.to === false))
    assert.equal(JSON.parse(readFileSync(join(root, "packages/c/tsconfig.json"))).references[0].path, "../p")
    assert.equal(readFileSync(join(root, "packages/p/src/main.ts"), "utf8"), "export interface Value { readonly id: string }\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("property: source redirect edits preserve JSONC comments, unrelated options and explicit false controls", async () => {
  const { enableSourceRedirect } = await import("../lib/declaration-redirects.mjs")
  fc.assert(fc.property(fc.constantFrom(true, false, "absent"), fc.string(), fc.boolean(), (flag, label, trailing) => {
    const text = "{\n // keep this true and option name in a comment\n \"compilerOptions\": { \"strict\": true, " +
      (flag === "absent" ? "" : '"disableSourceOfProjectReferenceRedirect": ' + flag + " /* retain comment */, ") +
      '"paths": { "@/*": [' + JSON.stringify(label) + "] }" + (trailing ? "," : "") + " }\n}"
    const next = enableSourceRedirect(text, ts)
    const before = ts.parseConfigFileTextToJson("tsconfig.json", text).config
    const after = ts.parseConfigFileTextToJson("tsconfig.json", next).config
    assert.deepEqual(after, flag === true ? { ...before, compilerOptions: { ...before.compilerOptions, disableSourceOfProjectReferenceRedirect: false } } : before)
    assert.equal(next.includes("retain comment"), text.includes("retain comment"))
    assert.equal(enableSourceRedirect(next, ts), next)
    if (flag !== true) assert.equal(next, text)
  }), { seed: 570054, numRuns: 200 })
})

test("inherited external presets are overridden locally while owned bases avoid redundant overrides", async () => {
  const { wireDeclarationRedirects } = await import("../lib/declaration-redirects.mjs")
  const root = mkdtempSync(join(tmpdir(), "alchemy-source-presets-"))
  const put = (file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), JSON.stringify(value)) }
  try {
    put("node_modules/@preset/config/package.json", { name: "@preset/config", version: "1.0.0", tsconfig: "tsconfig.json" })
    put("node_modules/@preset/config/tsconfig.json", { compilerOptions: { disableSourceOfProjectReferenceRedirect: true, strict: true } })
    const foreign = readFileSync(join(root, "node_modules/@preset/config/tsconfig.json"), "utf8")
    put("tsconfig.base.json", { compilerOptions: { disableSourceOfProjectReferenceRedirect: true, strict: true } })
    put("packages/owned/tsconfig.json", { extends: "../../tsconfig.base.json", include: ["src"] })
    put("packages/external/tsconfig.json", { extends: "@preset/config/tsconfig.json", include: ["src"] })
    put("packages/empty-options/tsconfig.json", { extends: "@preset/config/tsconfig.json", compilerOptions: {}, include: ["src"] })
    const configs = ["packages/owned/tsconfig.json", "packages/external/tsconfig.json", "packages/empty-options/tsconfig.json", "tsconfig.base.json"]
    const result = wireDeclarationRedirects({ root, ts, configs })
    assert.deepEqual(new Set(result.changed), new Set(["tsconfig.base.json", "packages/external/tsconfig.json", "packages/empty-options/tsconfig.json"]))
    assert.equal(JSON.parse(readFileSync(join(root, "packages/owned/tsconfig.json"))).compilerOptions, undefined)
    assert.deepEqual(result.edits.map(e => e.inherited), [false, true, true])
    for (const file of configs) {
      const path = join(root, file), raw = ts.readConfigFile(path, ts.sys.readFile)
      assert.equal(ts.parseJsonConfigFileContent(raw.config, ts.sys, dirname(path), {}, path).options.disableSourceOfProjectReferenceRedirect, false)
    }
    assert.equal(readFileSync(join(root, "node_modules/@preset/config/tsconfig.json"), "utf8"), foreign)
    assert.deepEqual(wireDeclarationRedirects({ root, ts, configs }), { changed: [], edits: [] })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("source redirect inventory excludes fixture, hidden, vendored and submodule projects", async () => {
  const { wireDeclarationRedirects } = await import("../lib/declaration-redirects.mjs")
  const root = mkdtempSync(join(tmpdir(), "alchemy-source-owners-"))
  const put = (file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value)) }
  try {
    put("package.json", { private: true, workspaces: ["packages/*", "submodules/*"] })
    put(".gitmodules", '[submodule "foreign"]\n path = submodules/foreign\n')
    put("vendor/package.json", { name: "foreign" })
    for (const file of ["tsconfig.json", "packages/own/tsconfig.json", "fixtures/example/tsconfig.json", ".hidden/tsconfig.json", "vendor/tsconfig.json", "submodules/foreign/tsconfig.json", "node_modules/preset/tsconfig.json"]) {
      put(file, { compilerOptions: { disableSourceOfProjectReferenceRedirect: true } })
    }
    put("packages/own/package.json", { name: "@fixture/own" })
    put("submodules/foreign/package.json", { name: "@foreign/sub" })
    const configs = ownedTsconfigs(root).filter(file => !isProtectedFile(file))
    assert.deepEqual(configs.sort(), ["packages/own/tsconfig.json", "tsconfig.json"])
    const result = wireDeclarationRedirects({ root, ts, configs })
    assert.equal(result.changed.length, 2)
    for (const file of ["fixtures/example/tsconfig.json", ".hidden/tsconfig.json", "vendor/tsconfig.json", "submodules/foreign/tsconfig.json", "node_modules/preset/tsconfig.json"]) {
      assert.equal(JSON.parse(readFileSync(join(root, file))).compilerOptions.disableSourceOfProjectReferenceRedirect, true, file)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("malformed configs and nonliteral redirect values remain unchanged", async () => {
  const { enableSourceRedirect } = await import("../lib/declaration-redirects.mjs")
  for (const text of ['{invalid', '{"compilerOptions":null}', '{"compilerOptions":{"disableSourceOfProjectReferenceRedirect":"true"}}', '{"compilerOptions":{"disableSourceOfProjectReferenceRedirect":false}}']) {
    assert.equal(enableSourceRedirect(text, ts, { inherited: true }), text)
  }
  const comment = '{"compilerOptions":{/* true */"strict":true},"text":"disableSourceOfProjectReferenceRedirect true"}'
  const next = enableSourceRedirect(comment, ts, { inherited: true })
  assert.ok(next.includes('/* true */'))
  assert.equal(ts.parseConfigFileTextToJson("tsconfig.json", next).config.compilerOptions.disableSourceOfProjectReferenceRedirect, false)
})

const namespaceCorpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-namespace-source-redirect.json", import.meta.url), "utf8"))
test("Alchemy namespace corpus cites the source-sidecar contract", () => {
  const chapter = readFileSync(SpecPath(namespaceCorpus.spec.split("/").at(-1)), "utf8")
  assert.ok(chapter.includes(namespaceCorpus.quote),
    `${namespaceCorpus.key}: ${namespaceCorpus.spec} no longer contains the corpus quote: ${namespaceCorpus.quote}`)
})

test("real Oxlint: referenced namespace remains typed after setup source redirects", {
  skip: process.env.VIBELANG_DECLARATION_REDIRECT_ORACLE !== "1"
}, async () => {
  const { inspectNamespaceRedirect } = await import("./declaration-redirects-oracle.mjs")
  const { resolve } = await import("node:path")
  const compiler = process.env.VIBELANG_BINARY || resolve("packages/compiler/native/vibelang")
  const lintModules = process.env.VIBELANG_OXLINT_MODULES || resolve("packages/compiler/node_modules")
  const lint = join(lintModules, ".bin/oxlint")
  const inspect = input => {
    const root = mkdtempSync(join(tmpdir(), "alchemy-native-namespace-"))
    try { inspectNamespaceRedirect(root, input, { ts, compiler, lint, lintModules }) }
    finally { rmSync(root, { recursive: true, force: true }) }
  }
  inspect(namespaceCorpus)
  fc.assert(fc.property(
    fc.record({ name: fc.constantFrom("DBCluster", "Resource", "Bucket", "Entity"), namespace: fc.constantFrom("RDS", "Storage", "Database"), depth: fc.integer({ min: 0, max: 3 }) }),
    input => { inspect(input); return true }
  ), { seed: 570054, numRuns: 12 })
})
