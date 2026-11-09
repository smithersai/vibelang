import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { makeConfig, paths, setup, verify } from "../lib/steps.mjs"
import * as Baseline from "../lib/baseline.mjs"
import { check } from "../lib/diagnostics.mjs"
import { declarationNames, unprovenMigrations } from "../lib/oracle.mjs"
import { packRepository } from "../lib/pack-policy.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const native = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/project-declaration-baselines.json", import.meta.url), "utf8"))

test("real setup and verification retain each referenced project's declarations", { timeout: 180000 }, async () => {
  assert.ok(existsSync(native), "Build the native compiler before running the project declaration integration test")
  const root = mkdtempSync(join(tmpdir(), "project-declaration-baselines-"))
  const target = join(root, "repo"), run = join(root, "run"), p = paths(run)
  const put = (name, value) => {
    const file = join(target, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value))
  }
  try {
    put("package.json", { name: "referenced-declarations", version: "1.0.0", type: "module",
      exports: { "./first": "./first/main.ts", "./second": "./second/main.ts" }, files: ["first", "second"] })
    put(".gitignore", "node_modules/\ndist/\n")
    put("tsconfig.json", { files: [], references: corpus.projects.map(path => ({ path })) })
    for (const [index, project] of corpus.projects.entries()) {
      const dir = index ? "second" : "first"
      put(project, { compilerOptions: { strict: true, types: [], target: "ES2022", module: "ESNext",
        rootDir: index ? "./second" : "../first", outDir: index ? "./dist/second" : "../dist/first" }, files: [index ? "./second/main.ts" : "../first/main.ts"] })
      put(dir + "/main.ts", corpus.sources[index])
    }
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    symlinkSync(native, join(target, "node_modules/.bin/vibelang"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    const revision = await Jj.commit(target, "original referenced APIs")
    const config = makeConfig({ target, packages: ["."], test: "true", vibelangVersion: "0.0.13",
      stockCompiler: require.resolve("typescript/bin/tsc"), wire: false })
    writeJson(p.config, config)
    writeJson(p.upgrade, { jj: { initialized: true, commit: revision, baseCommit: revision }, effect: { to: "4.1.1" }, changed: [], tests: {} })
    writeJson(join(p.baseline, "upgraded-tests.json"), { code: 0, tests: {} })
    const originalCheck = { compiler: "original", code: 0, diagnostics: [] }
    for (const [index, tsconfig] of corpus.projects.entries()) {
      const checked = await check({ compiler: native, tsconfig, cwd: target, root: target,
        log: join(run, "original-compile-" + index + ".log") })
      originalCheck.code ||= checked.code
      originalCheck.diagnostics.push(...checked.diagnostics)
    }
    assert.equal(originalCheck.code, 0, JSON.stringify(originalCheck))
    writeJson(join(p.baseline, "upstream-checks.json"), { ".": originalCheck })
    writeJson(join(p.baseline, "upgraded-checks.json"), { ".": originalCheck })
    writeJson(join(p.baseline, "upstream-packs.json"), await packRepository(config, join(run, "packs")))
    const original = await setup({ run })
    assert.deepEqual(original.declarationOracle["."], { compiler: "tsc", unproven: 0 },
      "every original project must have a stock/native declaration proof")
    writeJson(p.plan, { batches: [{ files: ["first/main.ts"] }] })
    const unchanged = await verify({ run, batch: "01" })
    const baseline = Baseline.declarationBaselineDir(p, ".", ["."])
    const surfaceFile = join(baseline, "public-surface.json")
    const surface = JSON.parse(readFileSync(surfaceFile, "utf8"))
    const savedSurface = structuredClone(surface)
    const prefixes = surface.apiMetadata.layouts.map(layout => layout.prefix)
    const originalDeclarations = prefixes.map(prefix => readFileSync(join(baseline, prefix, "main.d.ts"), "utf8"))
    for (const prefix of prefixes) for (const key of [Baseline.setupCompileKey("."), Baseline.declarationKey(".")]) {
      assert.ok(existsSync(join(p.baseline, "logs", dirname(key), prefix, basename(key) + ".log")),
        "each project's compiler receipt must retain its own log")
    }
    assert.equal(new Set(prefixes).size, 2, "recorded project outputs must remain separate")
    for (const [index, prefix] of prefixes.entries()) assert.match(readFileSync(join(baseline, prefix, "main.d.ts"), "utf8"),
      index ? /string/ : /number/)
    // Changing the first API to the other project's API must still fail.
    put("first/main.ts", corpus.sources[1])
    const changed = await verify({ run, batch: "01" })
    assert.deepEqual({ unchanged: unchanged.checks.declarations, changed: changed.checks.declarations },
      { unchanged: true, changed: false }, "unchanged and changed referenced APIs")
    // Model a saved legacy layout, including the overwritten first output.
    for (const [index, prefix] of prefixes.entries()) {
      const legacy = join(baseline, slug(corpus.projects[index]))
      rmSync(legacy, { recursive: true, force: true })
      renameSync(join(baseline, prefix), legacy)
      surface.apiMetadata.layouts[index].prefix = slug(corpus.projects[index])
    }
    rmSync(join(baseline, "projects-v2"), { recursive: true, force: true })
    writeJson(surfaceFile, surface)
    await assert.rejects(verify({ run, batch: "01" }), error =>
      /legacy declaration directory aliases projects/.test(error.message) &&
      corpus.projects.every(project => error.message.includes(project)))

    // An unambiguous legacy baseline still compares with newly isolated output.
    const legacyProjects = ["first.json", "second.json"]
    put("tsconfig.json", { files: [], references: legacyProjects.map(path => ({ path })) })
    for (const [index, project] of legacyProjects.entries()) {
      const source = index ? "second" : "first"
      put(project, { compilerOptions: { strict: true, types: [], target: "ES2022", module: "ESNext",
        rootDir: source, outDir: "dist/" + source }, files: [source + "/main.ts"] })
      put(source + "/main.ts", corpus.sources[index])
      mkdirSync(join(baseline, project), { recursive: true })
      writeFileSync(join(baseline, project, "main.d.ts"), originalDeclarations[index])
    }
    const remap = value => typeof value === "string"
      ? prefixes.reduce((text, prefix, index) => text === prefix || text.startsWith(prefix + "/")
        ? legacyProjects[index] + text.slice(prefix.length) : text, value)
      : Array.isArray(value) ? value.map(remap)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [remap(key), remap(item)])) : value
    writeJson(surfaceFile, remap(savedSurface))
    const legacyUnchanged = await verify({ run, batch: "01" })
    assert.equal(legacyUnchanged.checks.declarations, true, "unambiguous old project layouts remain readable")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function fixture(action) {
  const dir = mkdtempSync(join(tmpdir(), "project-declaration-identity-"))
  try { return action(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("legacy project collisions require fresh setup with every project named", () => fixture(dir => {
  for (const projects of [corpus.projects, ...corpus.neighbours].filter(pair => slug(pair[0]) === slug(pair[1]))) {
    for (const surface of [null, { apiMetadata: { layouts: projects.map(tsconfig => ({ prefix: slug(tsconfig) })) } }]) {
      assert.throws(() => Baseline.baselineDeclarationProjects(projects, dir, surface), error =>
        /legacy declaration directory aliases projects/.test(error.message) &&
        projects.every(project => error.message.includes(project)))
    }
  }
}))

test("single and unambiguous legacy project layouts retain their recorded paths", () => fixture(dir => {
  const single = ["tsconfig.json"], projects = ["tsconfig.node.json", "tsconfig.web.json"]
  assert.deepEqual(Baseline.declarationProjects(single), [{ tsconfig: single[0], prefix: "." }])
  assert.deepEqual(Baseline.baselineDeclarationProjects(single, dir), Baseline.declarationProjects(single))
  assert.deepEqual(Baseline.baselineDeclarationProjects(projects, dir), projects.map(tsconfig => ({ tsconfig, prefix: slug(tsconfig) })))
  const modern = Baseline.declarationProjects(projects)
  const saved = { apiMetadata: { layouts: modern.map(({ prefix }) => ({ prefix })) } }
  assert.deepEqual(Baseline.baselineDeclarationProjects(projects, dir, saved), modern)
  // A partial modern snapshot must never fall back to old output.
  writeJson(join(dir, "projects-v2", "layout.json"), { version: 2 })
  assert.deepEqual(Baseline.baselineDeclarationProjects(corpus.projects, dir), Baseline.declarationProjects(corpus.projects))
}))

test("property: project snapshots keep distinct source types and bounded identities", () => {
  const segment = fc.array(fc.constantFrom("a", "b", "_", "%", " ", "δ"), { minLength: 1, maxLength: 7 }).map(chars => chars.join(""))
  const config = fc.array(segment, { minLength: 1, maxLength: 3 }).map(parts => parts.join("/") + ".json")
  fc.assert(fc.property(fc.uniqueArray(config, { minLength: 2, maxLength: 6 }), projects => fixture(dir => {
    const layout = Baseline.declarationProjects(projects)
    assert.equal(new Set(layout.map(p => p.prefix)).size, projects.length)
    for (const [index, project] of layout.entries()) {
      const out = join(dir, project.prefix)
      mkdirSync(out, { recursive: true })
      writeFileSync(join(out, "main.d.ts"), 'export declare const value: "project-' + index + '";')
      assert.ok(Buffer.byteLength(project.prefix.split("/").at(-1)) <= 255)
    }
    writeJson(join(dir, "projects-v2", "layout.json"), { version: 2 })
    assert.deepEqual(Baseline.baselineDeclarationProjects(projects, dir), layout)
    for (const [index, project] of layout.entries()) assert.match(readFileSync(join(dir, project.prefix, "main.d.ts"), "utf8"),
      new RegExp('"project-' + index + '"'))
  })), { seed: 374900, numRuns: 150, examples: [corpus.projects, ...corpus.neighbours,
    ["δ".repeat(90) + ".json", "δ".repeat(89) + "a.json"]].map(projects => [projects]) })
})

test("legacy stock oracle refusals retain the baseline's project output names", () => fixture(dir => {
  const projects = ["first.json", "second.json"]
  for (const [index, project] of projects.entries()) {
    const name = "source" + index
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, "main.ts"), corpus.sources[index])
    writeJson(join(dir, project), { compilerOptions: { rootDir: name, types: [] }, files: [name + "/main.ts"] })
  }
  const names = declarationNames(ts, dir, Baseline.baselineDeclarationProjects(projects, dir))
  const declaration = "first.json/main.d.ts"
  assert.equal(names["source0/main.ts"], declaration)
  const result = unprovenMigrations({ migrated: ["source0/main.vibe"], pkgDir: ".", names,
    oracle: { files: [declaration], missing: [declaration], extra: [], changed: [] } })
  assert.equal(result.length, 1)
  assert.equal(result[0].declaration, declaration)
}))

test("a legacy project named projects-v2 cannot certify its colliding neighbours", () => fixture(dir => {
  mkdirSync(join(dir, "projects-v2"), { recursive: true })
  assert.throws(() => Baseline.baselineDeclarationProjects([...corpus.projects, "projects-v2"], dir),
    /legacy declaration directory aliases projects/)
}))
