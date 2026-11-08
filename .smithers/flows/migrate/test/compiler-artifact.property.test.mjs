import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { bindCompilerArtifact, compilerArtifactOf } from "../lib/toolchain.mjs"
import { codemod, compile, paths, record, verify } from "../lib/steps.mjs"
import { onePassStep } from "../lib/onepass.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const digest = value => createHash("sha256").update(value).digest("hex")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-compiler-artifact.json", import.meta.url), "utf8"))
const revision = corpus.revision
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "migration-compiler-artifact-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync("jj", ["git", "init"], { cwd: root, stdio: "pipe" })
  const tool = join(root, "tool"), p = paths(join(root, "run"))
  mkdirSync(tool); mkdirSync(p.run)
  const manifest = { commit: revision, compiler: "native", packages: {} }
  const set = (bytes, rev = revision) => {
    writeFileSync(join(tool, "native"), bytes)
    writeFileSync(join(tool, "toolchain.json"), JSON.stringify({ ...manifest, commit: rev }))
  }
  set(corpus.nativeBefore)
  const config = { target: root, packages: [], toolchain: { kind: "staged", dir: tool } }
  writeFileSync(p.config, JSON.stringify(config))
  writeFileSync(p.plan, JSON.stringify({ batches: [{ files: [] }], mode: "one-pass" }))
  return { root, tool, p, config, set }
}

test("a conversion pins actual native bytes independently of the source revision label", t => {
  const f = fixture(t)
  const artifact = bindCompilerArtifact(f.config, f.p)
  assert.deepEqual(artifact, { revision, nativeSha256: digest(corpus.nativeBefore) })
  assert.deepEqual(JSON.parse(readFileSync(f.p.config)).compilerArtifact, artifact)
  assert.deepEqual(bindCompilerArtifact(f.config, f.p, { resume: true }), artifact)
  f.set(corpus.nativeAfter)
  assert.throws(() => bindCompilerArtifact(f.config, f.p), /compiler artifact changed/)
})

test("loader-only edits preserve the artifact; a new revision with the same binary is still a different producer", t => {
  const f = fixture(t)
  const artifact = bindCompilerArtifact(f.config, f.p)
  writeFileSync(join(f.tool, "register.mjs"), "export const loader = 2")
  assert.deepEqual(compilerArtifactOf(f.config.toolchain), artifact)
  f.set("native compiler A", "1123456789abcdef0123456789abcdef01234567")
  assert.throws(() => bindCompilerArtifact(f.config, f.p), /compiler artifact changed/)
})

test("old conversion receipts cannot acquire a fresh producer label at record time", async t => {
  const f = fixture(t)
  assert.throws(() => bindCompilerArtifact(f.config, f.p, { resume: true }), /no compiler artifact receipt/)
  assert.equal(JSON.parse(readFileSync(f.p.config)).compilerArtifact, undefined)
  for (const phase of [compile, verify, record]) {
    await assert.rejects(phase({ run: f.p.run, batch: "01", force: "cannot waive missing provenance" }), /no compiler artifact receipt/, phase.name)
  }
})

test("all flow phases reject a replaced compiler before running any target operation", async t => {
  const f = fixture(t)
  bindCompilerArtifact(f.config, f.p)
  f.set("a replacement compiler retaining the same revision")
  for (const phase of [codemod, compile, verify, record]) {
    await assert.rejects(phase({ run: f.p.run, batch: "01", force: "cannot waive provenance" }), /compiler artifact changed/, phase.name)
  }
  for (const phase of ["rename", "check", "settle"]) {
    await assert.rejects(onePassStep(phase, { run: f.p.run }), /compiler artifact changed/, phase)
  }
})

test("a pinned staged conversion cannot resume with an untracked installed compiler", async t => {
  const f = fixture(t)
  bindCompilerArtifact(f.config, f.p)
  f.config.toolchain = { kind: "npm", version: "0.0.12" }
  writeFileSync(f.p.config, JSON.stringify(f.config))
  assert.throws(() => bindCompilerArtifact(f.config, f.p), /compiler artifact changed/)
  for (const phase of [codemod, compile, verify, record]) {
    await assert.rejects(phase({ run: f.p.run, batch: "01", force: "cannot waive provenance" }), /compiler artifact changed/, phase.name)
  }
  for (const phase of ["rename", "check", "settle"]) {
    await assert.rejects(onePassStep(phase, { run: f.p.run }), /compiler artifact changed/, phase)
  }
})

test("property: changing native bytes or producer identity always invalidates a pinned receipt", t => {
  const f = fixture(t)
  fc.assert(fc.property(fc.uint8Array({ minLength: 1, maxLength: 128 }), fc.boolean(), (bytes, changeRevision) => {
    const source = Buffer.from(bytes), changed = Buffer.concat([source, Buffer.from([0])])
    f.set(source)
    const config = { ...f.config }
    delete config.compilerArtifact
    const artifact = bindCompilerArtifact(config, f.p)
    assert.equal(artifact.nativeSha256, digest(source))
    f.set(changeRevision ? source : changed, changeRevision ? "1123456789abcdef0123456789abcdef01234567" : revision)
    assert.throws(() => bindCompilerArtifact(config, f.p), /compiler artifact changed/)
  }), { seed: 3702026, numRuns: 160 })
})

