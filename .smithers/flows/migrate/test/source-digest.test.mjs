import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import * as Jj from "../lib/jj.mjs"
import { checkStack, convertedIn, manifestOf, manifestOfTree, producerOf, readManifest, sha256, shapeOf, staleSources } from "../lib/source-digest.mjs"
import { paths, record, sourceDigests } from "../lib/steps.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const step = fileURLToPath(new URL("../step.mjs", import.meta.url))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const journal = (from, text) => ({ from, to: from.replace(/\.ts$/, ".vibe"), bytes: Buffer.from(text).toString("base64"), mode: 0o644 })
const PRODUCER = "vibelang@0.0.11"
const entry = (from, text, toolchain = PRODUCER) => ({ from, to: from.replace(/\.ts$/, ".vibe"), sha256: sha256(Buffer.from(text)), shape: shapeOf(Buffer.from(text)), toolchain })

async function repo(body) {
  const root = mkdtempSync(join(tmpdir(), "migrate-source-digest-")), target = join(root, "repo")
  try {
    mkdirSync(target)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    put(target, ".gitignore", "node_modules/\n")
    put(target, "package.json", "{}\n")
    await body({ root, target })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// A real run: the working copy holds the conversion, its journal holds the bytes it read.
async function converted({ root, target }, text, { base = text } = {}) {
  const run = join(root, "run"), p = paths(run)
  put(target, "src/X.ts", base)
  await Jj.commit(target, "base")
  mkdirSync(join(target, "node_modules"), { recursive: true })
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  renameSync(join(target, "src/X.ts"), join(target, "src/X.vibe"))
  writeJson(p.config, { target, toolchain: { kind: "npm", version: "0.0.11" }, packages: [], test: { cwd: "." }, bookmark: "vibe" })
  writeJson(p.inventory, { files: [{ path: "src/X.ts", tokens: 7 }] })
  writeJson(p.plan, { batches: [{ files: ["src/X.ts"], reason: "regression" }] })
  writeJson(p.codemod("01"), { renames: [{ from: "src/X.ts", to: "src/X.vibe" }], fix: { totals: {}, refused: [] } })
  writeJson(p.codemodState("01"), { originals: [journal("src/X.ts", text)] })
  writeJson(p.verify("01"), { ok: true, checks: { packs: true } })
  return { run, p }
}

test("a fresh conversion records, and its record keeps the digest", async () => repo(async f => {
  const { run, p } = await converted(f, "export const x = 1\n")
  const result = await record({ run, batch: "01", force: "no other checks in this fixture" })
  assert.ok(result.commit)
  assert.equal(result.sourceDigests, 1)
  assert.deepEqual(readManifest(p.sourceDigests("01")), [entry("src/X.ts", "export const x = 1\n")])
}))

test("a stale conversion is refused, naming the module, and force does not reach the gate", async () => repo(async f => {
  const { run, p } = await converted(f, "export const x = 1\n", { base: "export const x = 2\n" })
  const parent = await Jj.commitId(f.target)
  await assert.rejects(record({ run, batch: "01", force: "ignored" }), /record refused: stale conversion: 1 of 1 modules[\s\S]*src\/X\.ts/)
  assert.equal(await Jj.commitId(f.target), parent)
  assert.equal(existsSync(p.record("01")), false)
}))

test("a later base-side edit is refused once the conversion is rebased onto it", async () => repo(async f => {
  const source = "export const x = 1\n"
  const { run } = await converted(f, source)
  const converted_ = await Jj.commitId(f.target, "@")
  await must(`jj new @-`, { cwd: f.target })
  put(f.target, "src/X.ts", "export const x = 1\nexport const later = 2\n")
  await Jj.commit(f.target, "a later change on the base")
  const later = await Jj.commitId(f.target, "@-")
  await must(`jj edit ${converted_} && jj rebase -r @ -d ${later}`, { cwd: f.target })
  // The rebase conflicts on the deleted file; the driver that resolves it by taking the .vibe is the silent revert.
  rmSync(join(f.target, "src/X.ts"), { force: true })
  await assert.rejects(record({ run, batch: "01", force: "ignored" }), /record refused: stale conversion[\s\S]*src\/X\.ts/)
}))

test("a module missing from the base is refused, not read as current", async () => repo(async f => {
  put(f.target, "a.ts", "")
  await Jj.commit(f.target, "base")
  const stale = await staleSources(f.target, [entry("src/gone.ts", "x")], () => "@-")
  assert.equal(stale.length, 1)
  assert.equal(stale[0].base, null)
}))

test("an empty source is a file with a digest, and an unknown revision throws", async () => repo(async f => {
  put(f.target, "empty.ts", "")
  await Jj.commit(f.target, "base")
  assert.deepEqual(await staleSources(f.target, [entry("empty.ts", "")], () => "@-"), [])
  await assert.rejects(staleSources(f.target, [entry("empty.ts", "")], () => "no-such-revision"))
}))

test("digests read exact bytes: invalid UTF-8 and a multi-byte character across a pipe chunk", async () => repo(async f => {
  const invalid = Buffer.from([0x63, 0xff, 0xfe, 0x0a]), wide = Buffer.from("é".repeat(200_000))
  writeFileSync(join(f.target, "invalid.ts"), invalid)
  writeFileSync(join(f.target, "wide.ts"), wide)
  writeFileSync(join(f.target, "$id [x] (y).ts"), "z")
  await Jj.commit(f.target, "base")
  assert.deepEqual(await staleSources(f.target, [
    { from: "invalid.ts", to: "invalid.vibe", sha256: sha256(invalid) },
    { from: "wide.ts", to: "wide.vibe", sha256: sha256(wide) },
    { from: "$id [x] (y).ts", to: "$id [x] (y).vibe", sha256: sha256("z") }
  ], () => "@-"), [])
}))

test("a commit converts a removed .ts whose .vibe it adds, whichever file jj pairs the rename with", () => {
  assert.deepEqual(convertedIn([{ status: "R", from: "a.ts", path: "a.d.vibe.ts" }, { status: "A", path: "a.vibe" }]), ["a.ts"])
  assert.deepEqual(convertedIn([{ status: "R", from: "a.ts", path: "a.vibe" }]), ["a.ts"])
  assert.deepEqual(convertedIn([{ status: "D", path: "a.ts" }, { status: "A", path: "a.vibe" }]), ["a.ts"])
  assert.deepEqual(convertedIn([{ status: "D", path: "dead.ts" }]), [])
  assert.deepEqual(convertedIn([{ status: "D", path: "a.d.ts" }, { status: "A", path: "a.d.vibe" }]), [])
  assert.deepEqual(convertedIn([{ status: "R", from: "a.vibe", path: "a.ts" }]), [])
})

const stackOf = async (target, modules) => {
  for (const [file, text] of Object.entries(modules)) put(target, file, text)
  const base = await Jj.commit(target, "base")
  for (const file of Object.keys(modules)) {
    renameSync(join(target, file), join(target, file.replace(/\.ts$/, ".vibe")))
    await Jj.commit(target, "convert " + file)
  }
  return base
}

test("the push gate passes a fresh stack, and compares each module with its own commit's parent", async () => repo(async f => {
  const base = await stackOf(f.target, { "a.ts": "a\n", "b.ts": "b\n" })
  const result = await checkStack(f.target, [[entry("a.ts", "a\n"), entry("b.ts", "b\n")]], base, "@-")
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.converted, 2)
}))

test("an importer rewritten earlier in the stack passes against the bytes it was converted from", async () => repo(async f => {
  put(f.target, "dep.ts", "d\n")
  put(f.target, "app.ts", 'import "./dep.ts"\n')
  const base = await Jj.commit(f.target, "base")
  renameSync(join(f.target, "dep.ts"), join(f.target, "dep.vibe"))
  put(f.target, "app.ts", 'import "./dep.vibe"\n')
  await Jj.commit(f.target, "convert dep and rewrite its importer")
  renameSync(join(f.target, "app.ts"), join(f.target, "app.vibe"))
  await Jj.commit(f.target, "convert app")
  const result = await checkStack(f.target, [[entry("dep.ts", "d\n"), entry("app.ts", 'import "./dep.vibe"\n')]], base, "@-")
  assert.equal(result.ok, true, JSON.stringify(result))
}))

test("the push gate refuses a stale module and a module with no record, through the CLI's exit code", async () => repo(async f => {
  const base = await stackOf(f.target, { "a.ts": "new\n", "b.ts": "b\n" })
  const manifest = join(f.root, "manifest.json")
  writeJson(manifest, { version: 1, modules: [entry("a.ts", "old\n")] })
  const result = await sourceDigests({ target: f.target, manifests: [manifest], base, head: "@-" })
  assert.equal(result.ok, false)
  assert.deepEqual(result.stale.map(s => s.from), ["a.ts"])
  assert.deepEqual(result.unrecorded, ["b.ts"])
  assert.throws(() => execFileSync("node", [step, "source-digests", "--target", f.target, "--manifest", manifest, "--base", base], { stdio: "pipe" }), e => e.status === 1 && JSON.parse(e.stdout).unrecorded[0] === "b.ts")
  writeJson(manifest, { version: 1, modules: [entry("a.ts", "new\n"), entry("b.ts", "b\n")] })
  assert.equal(JSON.parse(execFileSync("node", [step, "source-digests", "--target", f.target, "--manifest", manifest, "--base", base], { stdio: "pipe" })).ok, true)
}))

test("the push gate reads a run's saved manifests and answers for a module's last conversion", async () => repo(async f => {
  const { run, p } = await converted(f, "export const x = 1\n")
  const base = await Jj.commitId(f.target, "@--")
  await record({ run, batch: "01", force: "no other checks in this fixture" })
  assert.equal((await sourceDigests({ run, base, head: "@-" })).ok, true)
  writeJson(p.sourceDigests("01"), manifestOf([journal("src/X.ts", "older\n")], PRODUCER))
  assert.deepEqual((await sourceDigests({ run, base, head: "@-" })).stale.map(s => s.from), ["src/X.ts"])
}))

test("a bad manifest is an error, not an empty record", async () => repo(async f => {
  const file = join(f.root, "manifest.json")
  writeFileSync(file, '{"version":2,"modules":[]}')
  assert.throws(() => readManifest(file), /version 1/)
  writeFileSync(file, '{"version":1,"modules":[{"from":"a.ts","sha256":"short"}]}')
  assert.throws(() => readManifest(file), /bad entry/)
}))

test("manifestOf digests the journal's bytes, not their base64", () => {
  assert.deepEqual(manifestOf([journal("a.ts", "text")], PRODUCER).modules, [entry("a.ts", "text")])
})

test("the gate refuses exactly the modules the base changed after conversion", async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), async edited => repo(async f => {
    const names = edited.map((_, i) => `m${i}.ts`)
    for (const name of names) put(f.target, name, `export const ${name[0]} = 1\n`)
    await Jj.commit(f.target, "conversion base")
    const manifest = names.map(name => entry(name, `export const ${name[0]} = 1\n`))
    names.forEach((name, i) => { if (edited[i]) put(f.target, name, "changed later\n") })
    await Jj.commit(f.target, "later base")
    const stale = await staleSources(f.target, manifest, () => "@-")
    assert.deepEqual(stale.map(s => s.from), names.filter((_, i) => edited[i]))
  })), { numRuns: 12, seed: 20261103 })
})

test("one pass split across commits: a specifier an earlier commit rewrote is not staleness", async () => repo(async f => {
  const app = 'import "./dep.ts"\nexport const app = 1\n'
  put(f.target, "dep.ts", "d\n")
  put(f.target, "app.ts", app)
  const base = await Jj.commit(f.target, "base")
  const manifest = manifestOfTree(f.target, ["dep.ts", "app.ts"], PRODUCER).modules
  renameSync(join(f.target, "dep.ts"), join(f.target, "dep.vibe"))
  put(f.target, "app.ts", app.replace("./dep.ts", "./dep.vibe"))
  await Jj.commit(f.target, "first group: dep and its importer's specifier")
  renameSync(join(f.target, "app.ts"), join(f.target, "app.vibe"))
  await Jj.commit(f.target, "second group: app")
  const result = await checkStack(f.target, [manifest], base, "@-")
  assert.equal(result.ok, true, JSON.stringify(result))
}))

test("shape erases only a relative specifier's extension", () => {
  const same = (a, b) => assert.equal(shapeOf(Buffer.from(a)), shapeOf(Buffer.from(b)), a)
  const differs = (a, b) => assert.notEqual(shapeOf(Buffer.from(a)), shapeOf(Buffer.from(b)), a)
  same('import "./a.ts"', 'import "./a.vibe"')
  same('import "../b/a.js"', 'import "../b/a.vibe"')
  same('new URL("./a.ts", import.meta.url)', 'new URL("./a.vibe", import.meta.url)')
  differs('import "./a.ts"', 'import "./b.ts"')
  differs('import "effect/a.ts"', 'import "effect/a.vibe"')
  differs('const x = 1', 'const x = 2')
  differs('import  "./a.ts"', 'import "./a.ts"')
})

test("a logic edit beside a rewritten specifier is stale, in every commit position", async () => repo(async f => {
  const app = 'import "./dep.ts"\nexport const app = 1\n'
  put(f.target, "app.ts", app)
  const base = await Jj.commit(f.target, "base")
  const manifest = manifestOfTree(f.target, ["app.ts"], PRODUCER).modules
  put(f.target, "app.ts", app.replace("./dep.ts", "./dep.vibe").replace("= 1", "= 2"))
  await Jj.commit(f.target, "a stack commit changes the logic too")
  renameSync(join(f.target, "app.ts"), join(f.target, "app.vibe"))
  await Jj.commit(f.target, "convert app")
  assert.deepEqual((await checkStack(f.target, [manifest], base, "@-")).stale.map(s => s.from), ["app.ts"])
}))

test("the CLI writes a tree's manifest and prints every stale module, past print's limit of 40", async () => repo(async f => {
  const names = Array.from({ length: 45 }, (_, i) => `m${i}.ts`)
  for (const name of names) put(f.target, name, "new\n")
  const base = await Jj.commit(f.target, "base")
  const tree = join(f.root, "tree"), list = join(f.root, "list.txt"), manifest = join(f.root, "manifest.json")
  for (const name of names) put(tree, name, "old\n")
  writeFileSync(list, names.join("\n") + "\n")
  assert.throws(() => execFileSync("node", [step, "source-manifest", "--tree", tree, "--list", list, "--out", manifest], { stdio: "pipe" }), /--toolchain/)
  execFileSync("node", [step, "source-manifest", "--tree", tree, "--list", list, "--toolchain", "0123456789ab", "--out", manifest], { stdio: "pipe" })
  assert.equal(readManifest(manifest).length, 45)
  for (const name of names) renameSync(join(f.target, name), join(f.target, name.replace(/\.ts$/, ".vibe")))
  await Jj.commit(f.target, "convert all")
  assert.throws(() => execFileSync("node", [step, "source-digests", "--target", f.target, "--manifest", manifest, "--base", base], { stdio: "pipe" }), e => e.status === 1 && JSON.parse(e.stdout).stale.length === 45)
}))

// Stale by converter (opencode, 2026-11-04): fresh source, old writer. The producer is recorded with the digest.
test("record names the staged toolchain's VibeLang commit as each module's producer", async () => repo(async f => {
  const { run, p } = await converted(f, "export const x = 1\n")
  const tool = join(f.root, "toolchain")
  put(tool, "toolchain.json", JSON.stringify({ commit: "b7be67a09d50aaaabbbbccccddddeeeeffff0000", compiler: "native/vibelang" }))
  const config = readJson(p.config); config.toolchain = { kind: "staged", dir: tool }; writeJson(p.config, config)
  await record({ run, batch: "01", force: "no other checks in this fixture" })
  assert.deepEqual(readManifest(p.sourceDigests("01")).map(m => m.toolchain), ["b7be67a09d50aaaabbbbccccddddeeeeffff0000"])
}))

test("record refuses a conversion whose toolchain records no commit, and force does not reach it", async () => repo(async f => {
  const { run, p } = await converted(f, "export const x = 1\n")
  const tool = join(f.root, "toolchain")
  put(tool, "toolchain.json", JSON.stringify({ compiler: "native/vibelang" }))
  const config = readJson(p.config); config.toolchain = { kind: "staged", dir: tool }; writeJson(p.config, config)
  const parent = await Jj.commitId(f.target)
  await assert.rejects(record({ run, batch: "01", force: "ignored" }), /record refused: no producing toolchain/)
  assert.equal(await Jj.commitId(f.target), parent)
  assert.equal(existsSync(p.record("01")), false)
}))

test("producerOf accepts a staged commit or a published version, and nothing else", () => repo(async f => {
  const dir = join(f.root, "t")
  put(dir, "toolchain.json", JSON.stringify({ commit: "2066118b494b", compiler: "c" }))
  assert.equal(producerOf({ kind: "staged", dir }), "2066118b494b")
  assert.equal(producerOf({ kind: "npm", version: "0.0.11" }), "vibelang@0.0.11")
  for (const bad of [{ kind: "staged", dir: join(f.root, "none") }, { kind: "registry" }, undefined]) assert.throws(() => producerOf(bad), /no producing toolchain/)
  put(dir, "toolchain.json", JSON.stringify({ commit: "HEAD", compiler: "c" }))
  assert.throws(() => producerOf({ kind: "staged", dir }), /no producing toolchain/)
}))

test("the push gate refuses a conversion with no producer, and one another toolchain wrote", async () => repo(async f => {
  const base = await stackOf(f.target, { "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" })
  const { toolchain, ...unproduced } = entry("c.ts", "c\n")
  const manifest = [entry("a.ts", "a\n", "2066118b494b"), entry("b.ts", "b\n", "41e2c4db4e29"), unproduced]
  const open = await checkStack(f.target, [manifest], base, "@-")
  assert.deepEqual(open.unproduced, ["c.ts"])
  assert.deepEqual(open.converter, [])
  const pinned = await checkStack(f.target, [manifest], base, "@-", { producers: ["2066118b494bdeadbeef"] })
  assert.equal(pinned.ok, false)
  assert.deepEqual(pinned.converter, [{ from: "b.ts", toolchain: "41e2c4db4e29" }])
  assert.deepEqual(pinned.stale, [])
  const file = join(f.root, "m.json")
  writeJson(file, { version: 1, modules: manifest.slice(0, 2) })
  const cli = (...producers) => JSON.parse(execFileSync("node", [step, "source-digests", "--target", f.target, "--manifest", file, ...producers.flatMap(p => ["--producer", p]), "--base", base, "--head", "@--"], { stdio: "pipe" }))
  assert.equal(cli("2066118b494b", "41e2c4db4e29").ok, true)
  assert.throws(() => cli("2066118b494b"), e => e.status === 1 && JSON.parse(e.stdout).converter[0].from === "b.ts")
}))

test("a manifest entry with a malformed producer is an error", async () => repo(async f => {
  const file = join(f.root, "m.json")
  writeJson(file, { version: 1, modules: [entry("a.ts", "a", "main")] })
  assert.throws(() => readManifest(file), /bad entry/)
}))

test("a toolchain switch cannot relabel a recorded conversion's producer", async () => repo(async f => {
  const { run, p } = await converted(f, "export const x = 1\n")
  const base = await Jj.commitId(f.target, "@--")
  await record({ run, batch: "01", force: "no other checks in this fixture" })
  const receipt = readFileSync(p.sourceDigests("01"), "utf8")
  const config = readJson(p.config)
  config.toolchain = { kind: "npm", version: "0.0.12" }
  writeJson(p.config, config)
  const result = await sourceDigests({ run, base, producers: ["vibelang@0.0.12"] })
  assert.equal(result.ok, false, "changing the current pin must not certify an older conversion")
  assert.deepEqual(result.converter, [{ from: "src/X.ts", toolchain: PRODUCER }])
  assert.equal((await sourceDigests({ run, base, producers: [PRODUCER] })).ok, true)
  assert.equal(readFileSync(p.sourceDigests("01"), "utf8"), receipt)
}))

const producerSwitch = JSON.parse(readFileSync(new URL("./corpus/opencode-conversion-producer-switch.json", import.meta.url), "utf8"))

test("conversion producer corpus follows the migration provenance rule", () => {
  const guide = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  assert.ok(guide.includes(producerSwitch.rule))
  assert.equal(producerSwitch.producer, PRODUCER)
})

test("a journal without a saved receipt cannot acquire the current producer", async () => repo(async f => {
  const { run, p } = await converted(f, producerSwitch.source)
  const base = await Jj.commitId(f.target, "@--")
  await record({ run, batch: "01", force: "no other checks in this fixture" })
  rmSync(p.sourceDigests("01"))
  const result = await sourceDigests({ run, base, producers: [PRODUCER] })
  assert.equal(result.ok, false)
  assert.deepEqual(result.unrecorded, ["src/X.ts"])
}))

test("saved provenance survives a replaced staged toolchain and a missing journal", async () => repo(async f => {
  const { run, p } = await converted(f, producerSwitch.source)
  const base = await Jj.commitId(f.target, "@--")
  await record({ run, batch: "01", force: "no other checks in this fixture" })
  rmSync(p.codemodState("01"))
  const config = readJson(p.config)
  config.toolchain = { kind: "staged", dir: join(f.root, "missing-toolchain") }
  writeJson(p.config, config)
  const result = await sourceDigests({ run, base, producers: [PRODUCER] })
  assert.equal(result.ok, true, JSON.stringify(result))
  writeFileSync(p.sourceDigests("01"), '{"version":2,"modules":[]}')
  await assert.rejects(sourceDigests({ run, base }), /version 1/)
}))

test("the CLI refuses the original producer after the run pin changes", async () => repo(async f => {
  const { run, p } = await converted(f, producerSwitch.source)
  const base = await Jj.commitId(f.target, "@--")
  await record({ run, batch: "01", force: "no other checks in this fixture" })
  const config = readJson(p.config)
  config.toolchain = { kind: "npm", version: producerSwitch.replacementVersion }
  writeJson(p.config, config)
  assert.throws(() => execFileSync("node", [step, "source-digests", "--run", run, "--base", base,
    "--producer", "vibelang@" + producerSwitch.replacementVersion], { stdio: "pipe" }), e =>
    e.status === 1 && JSON.parse(e.stdout).converter[0].toolchain === producerSwitch.producer)
}))

test("property: current pins and journal edits never change recorded source or producer", async () => repo(async f => {
  const { run, p } = await converted(f, producerSwitch.source)
  const base = await Jj.commitId(f.target, "@--")
  await record({ run, batch: "01", force: "no other checks in this fixture" })
  const config = readJson(p.config)
  const receipt = readFileSync(p.sourceDigests("01"), "utf8")
  await fc.assert(fc.asyncProperty(
    fc.record({ version: fc.constantFrom("0.0.10", "0.0.11", "0.0.12"), allowOriginal: fc.boolean(), text: fc.string({ maxLength: 32 }) }),
    async ({ version, allowOriginal, text }) => {
      config.toolchain = { kind: "npm", version }
      writeJson(p.config, config)
      writeJson(p.codemodState("01"), { originals: [journal("src/X.ts", text)] })
      const producers = [allowOriginal ? PRODUCER : "vibelang@0.0.12"]
      const result = await sourceDigests({ run, base, producers })
      assert.equal(result.ok, allowOriginal, JSON.stringify(result))
      assert.deepEqual(result.stale, [])
      assert.deepEqual(result.converter, allowOriginal ? [] : [{ from: "src/X.ts", toolchain: PRODUCER }])
      assert.equal(readFileSync(p.sourceDigests("01"), "utf8"), receipt)
    }), { seed: 337, numRuns: 24 })
}))
