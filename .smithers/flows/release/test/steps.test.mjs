import { writeFileSync } from "node:fs"
import assert from "node:assert/strict"
import { test } from "node:test"
import { build, candidate, check, publish, tail } from "../lib/steps.mjs"
import { fixture, NAMES, OTP } from "./fixture.mjs"

const options = (f) => ({ version: "0.0.1", registry: "http://registry.test/", skip: "" })

test("check refuses a registry npm is not logged in to", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  process.env.TEST_LOGGED_OUT = "1"
  t.after(() => delete process.env.TEST_LOGGED_OUT)
  await assert.rejects(check(f.root, options(f)), /npm is not logged in to http:\/\/registry\.test\//)
})

test("check records the publisher, the last published version and the toolchain", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  const checked = await check(f.root, options(f))
  assert.equal(checked.publisher, "releaser")
  assert.equal(checked.lastPublished, "0.0.0")
  assert.deepEqual(Object.keys(checked.toolchain), ["node", "npm", "go", "bun"])
})

test("publish refuses tarballs whose bytes changed after the approval", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  await build(f.root, options(f))
  const approved = candidate(f.root)
  assert.deepEqual(approved.map((pkg) => pkg.name), NAMES)
  f.tamper()
  await assert.rejects(publish(f.root, { ...options(f), otp: OTP, packages: approved, last: true }), /tarballs changed after the approval \(vibelang\)/)
  assert.deepEqual(f.calls().filter((call) => call[0] === "npm" && call[1] === "publish"), [])
})

test("the publication log hides the one-time password", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  await build(f.root, options(f))
  process.env.VIBELANG_RELEASE_OTP_FILE = f.root + "/otp"
  writeFileSync(process.env.VIBELANG_RELEASE_OTP_FILE, OTP, { mode: 0o600 })
  t.after(() => delete process.env.VIBELANG_RELEASE_OTP_FILE)
  const result = await publish(f.root, { ...options(f), otp: OTP, packages: candidate(f.root), last: true })
  assert.equal(result.published, true)
  const { readFileSync } = await import("node:fs")
  const log = readFileSync(`${f.root}/dist-npm/release/publish.log`, "utf8")
  assert.ok(!log.includes(OTP))
})

test("tail keeps the end of long output from a line start", () => {
  const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n")
  const kept = tail(text)
  assert.ok(kept.length <= 3000 && kept.startsWith("line ") && kept.endsWith("line 399"))
  assert.equal(tail("short"), "short")
})
