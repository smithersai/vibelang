// Runs the .vibe fuzz campaigns and checks what each report says.
import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as vibe from "./out/main.js"
import * as Fuzz from "vibelang-runtime/experimental/Fuzz"
import * as FuzzSimulation from "vibelang-runtime/experimental/FuzzSimulation"

const run = (effect) => Effect.runPromise(effect)

// Each module has its own subpath; Experimental.Fuzz in a .vibe file is the same module.
assert.equal(typeof Fuzz.run, "function")
assert.equal(typeof FuzzSimulation.execution, "function")
assert.equal(vibe.fuzzModule(), Fuzz.run)

// A Vibe schema where an Arbitrary goes; observations count as feedback.
const campaign = await run(vibe.campaign())
assert.equal(campaign.tag, "Passed")
assert.equal(campaign.executions, 2_000)
assert.equal(campaign.text, undefined)
assert.ok(campaign.observations > 0, "Fuzz.observe labels are a feedback source")

// The needle: found, shrunk to the header alone, and the same both times.
const magic = await run(vibe.magic(1))
assert.equal(magic.tag, "Falsified")
assert.equal(magic.signature, "ReturnedFalse")
assert.deepEqual(magic.input, [0x7f, 0x45])
assert.deepEqual(await run(vibe.magic(1)), magic, "the same seed gives the same report")
assert.match(magic.text, /ReturnedFalse after \d+ shrink/)
assert.match(magic.text, /Feedback: .*observations/)

// The token replays the shrunk input; against another generator it is a mismatch.
assert.deepEqual(await run(vibe.replay(magic.replay)), { tag: "Falsified", input: [0x7f, 0x45], stoppedBy: "Replay" })
assert.equal(await run(vibe.replayElsewhere(magic.replay)), "ReplayMismatch")

// Span feedback, on by default, reaches .vibe code through withSpan.
const spans = await run(vibe.spans())
assert.deepEqual(spans.found, [0x7f, 0x45])
assert.ok(spans.spans > 0, "withSpan stages are span features")
assert.equal(spans.observations, 0)
assert.equal(spans.feedback, "Feedback: spans")

// Typed failures and defects are findings with their own signatures, shrunk to the boundary.
const signatures = await run(vibe.signatures())
assert.deepEqual(signatures.failed, ["PropertyError:Boom", 11])
assert.deepEqual(signatures.died, ["Died:RangeError", 11])
assert.deepEqual(signatures.passed, ["Passed", 500, "Executions", true])

// A corpus store keeps the confirmed failure as a value and replays it first.
const corpus = await run(vibe.corpus())
assert.equal(corpus.first, "Value")
assert.deepEqual(corpus.second, [0, [0x7f, 0x45], 1])
assert.equal(corpus.failures, 1)

// A store that fails to save fails the run with FuzzError Corpus.
const broken = await Effect.runPromiseExit(vibe.brokenStore())
assert.ok(Exit.isSuccess(broken), String(broken.cause))
assert.deepEqual(broken.value, ["FuzzError", "Corpus", "disk full"])

// A score turns the needle into a hill.
assert.equal(await run(vibe.scored(false)), "Passed", "blind search misses the needle")
assert.equal(await run(vibe.scored(true)), 777_777_777, "the score climbs to it")

// The race: invisible to the default scheduler, found and replayed under simulation.
assert.deepEqual(await run(vibe.race(false)), { tag: "Passed" })
const race = await run(vibe.race(true))
assert.equal(race.tag, "Falsified")
assert.equal(race.signature, "ReturnedFalse")
assert.deepEqual(race.input, [1, 1])
assert.deepEqual(await run(vibe.race(true)), race, "the same seed gives the same schedule and result")
assert.deepEqual(await run(vibe.replayRace(race.replay)), [1, 1])

// A property waiting on nothing with no timer left is a Deadlock finding.
assert.equal(await run(vibe.deadlock()), "Deadlock")

console.log("fuzz campaigns agree")
