// Runs the release flow on the in-memory engine against the fixture checkout,
// answering its questions the way a maintainer answers them with
// `smthrs runs signal`.
import { writeFileSync } from "node:fs"
import assert from "node:assert/strict"
import { test } from "node:test"
import { Cause, Effect, Exit, Layer, Option, Schedule } from "effect"
import { FlowEngine } from "@smthrs/engine"
import { DurableDeferred, HumanTask, Interpreter } from "@smthrs/flow"
import { WebCrypto } from "@smthrs/crypto"
import release, { layer } from "../flow.ts"
import { fixture, NAMES, OTP } from "./fixture.mjs"

const runtime = Interpreter.layerWithImplementations(release, layer).pipe(
  Layer.provideMerge(FlowEngine.layerMemory),
  Layer.provideMerge(WebCrypto.layer)
)

// answer records value for the question name once the run is parked on it.
const answer = (executionId, name, value) =>
  HumanTask.answer({
    token: DurableDeferred.tokenFromExecutionId(HumanTask.deferred(name, 1), { flow: release, executionId }),
    value
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 1200 }),
    Effect.andThen(release.resume(executionId))
  )

// drive starts a run, gives each answer in order, and returns the run's exit.
function drive(f, answers, input = {}) {
  delete process.env.VIBELANG_RELEASE_OTP_FILE
  const executionId = `release-${Math.random().toString(36).slice(2)}`
  const program = Effect.gen(function*() {
    yield* release.execute({ version: "0.0.1", repo: f.root, registry: "http://registry.test/", ...input }, { executionId, discard: true })
    for (const [name, value] of answers) {
      if (name.startsWith("otp-") && value) {
        process.env.VIBELANG_RELEASE_OTP_FILE = f.root + "/otp"
        writeFileSync(process.env.VIBELANG_RELEASE_OTP_FILE, value, { mode: 0o600 })
      }
      yield* answer(executionId, name, name.startsWith("otp-") ? true : value)
      if (name.startsWith("otp-") && answers.some(([next]) => next === "otp-" + (Number(name.slice(4)) + 1))) {
        // Wait until npm consumed this round before replacing its private input.
        while (publishes(f).length < Number(name.slice(4))) yield* Effect.sleep("20 millis")
      }
    }
    return yield* release.execute({ version: "0.0.1", repo: f.root, registry: "http://registry.test/", ...input }, { executionId })
  })
  return Effect.runPromiseExit(program.pipe(Effect.provide(runtime)))
}

const failure = (exit) => {
  assert.ok(Exit.isFailure(exit), "the run succeeded")
  const error = Cause.findErrorOption(exit.cause)
  assert.ok(Option.isSome(error), Cause.pretty(exit.cause))
  return error.value
}

const publishes = (f) => f.calls().filter((call) => call[0] === "npm" && call[1] === "publish" && !call.includes("--dry-run"))

test("an approved run checks, builds, rehearses, publishes with the one-time password and verifies from the registry", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  const exit = await drive(f, [["publish", true], ["otp-1", "111111"], ["otp-2", OTP]])
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")
  assert.deepEqual(exit.value, { status: "published", version: "0.0.1", registry: "http://registry.test/" })
  const steps = f.calls().map((call) => call[0] === "npm" ? `npm ${call[1]}` : call[0])
  for (const [before, after] of [["e2e", "notes"], ["bun", "notes"], ["notes", "build-binaries"], ["make-packages", "rehearse"], ["rehearse", "npm publish"], ["npm publish", "check-app"]]) {
    assert.ok(steps.indexOf(before) >= 0 && steps.indexOf(before) < steps.lastIndexOf(after), `${before} runs before ${after}: ${steps.join(", ")}`)
  }
  assert.deepEqual(f.calls().find((call) => call[0] === "notes"), ["notes", "1", "0.0.0"])
  // The refused password published nothing; the second published every package with it.
  assert.deepEqual(publishes(f).map((call) => call[2].split("/").pop()), ["vibelang-linux-x64-0.0.1.tgz", ...NAMES.map(name => name + "-0.0.1.tgz")])
  assert.ok(publishes(f).every((call) => call.includes("http://registry.test/")))
  assert.deepEqual(f.calls().find((call) => call[0] === "check-app"), ["check-app", "http://registry.test/", "0.0.1", "npm", "bun"])
})

test("a declined run publishes nothing", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  const exit = await drive(f, [["publish", false]])
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")
  assert.equal(exit.value.status, "declined")
  assert.deepEqual(publishes(f), [])
  assert.equal(f.calls().filter((call) => call[0] === "check-app").length, 0)
})

test("VIBELANG_SKIP leaves packages out of the approval and the publication", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  const exit = await drive(f, [["publish", true], ["otp-1", OTP]], { skip: "win32" })
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")
  assert.deepEqual(publishes(f).map((call) => call[2].split("/").pop()), ["vibelang-linux-x64-0.0.1.tgz", "vibelang-0.0.1.tgz"])
})

test("three refused one-time passwords fail the run", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  const exit = await drive(f, [["publish", true], ["otp-1", "111111"], ["otp-2", "222222"], ["otp-3", "333333"]])
  const error = failure(exit)
  assert.equal(error.step, "publish")
  assert.match(error.message, /EOTP/)
})

test("a checkout at another version fails before anything is built", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  const exit = await drive(f, [], { version: "0.0.2" })
  const error = failure(exit)
  assert.equal(error.step, "check")
  assert.match(error.message, /compiler is 0\.0\.1, not 0\.0\.2/)
  assert.deepEqual(f.calls().filter((call) => call[0] !== "npm"), [])
})

test("an account with no one-time password publishes with an empty answer", async (t) => {
  const f = fixture(t)
  process.env.PATH = `${f.bin}:${process.env.PATH}`
  process.env.TEST_NO_OTP = "1"
  t.after(() => delete process.env.TEST_NO_OTP)
  const exit = await drive(f, [["publish", true], ["otp-1", ""]])
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")
  assert.deepEqual(publishes(f).map((call) => call.includes("--otp")), [false, false, false])
})

test("public publication deploys docs before live verification", async (t) => {
  const f = fixture(t)
  process.env.PATH = f.bin + ":" + process.env.PATH
  const result = await drive(f, [["publish", true], ["otp-1", OTP]], { registry: "https://registry.npmjs.org/" })
  assert.ok(Exit.isSuccess(result), Exit.isFailure(result) ? Cause.pretty(result.cause) : "")
  assert.deepEqual(f.calls().slice(-2), [["deploy", "0.0.1"], ["live", "0.0.1"]])
})
