import { expect, test } from "bun:test"
import fc from "fast-check"
import { recordingOutput } from "../../site/scripts/record-starter-test.mjs"

test("recording output keeps generated messages while removing terminal colors and the scratch root", () => {
  fc.assert(fc.property(fc.array(fc.string({ unit: "grapheme", maxLength: 24 }), { minLength: 1, maxLength: 12 }), values => {
    const project = "recording-fixture/project"
    const lines = values.map(value => JSON.stringify(value))
    const plain = project + "\n" + lines.join("\n")
    const colored = "\x1b[32m" + plain + "\x1b[0m"
    expect(recordingOutput(colored, project)).toBe("my-app\n" + lines.join("\n"))
  }), { numRuns: 200 })
})
test("recording output omits only the test runner's start-time line", () => {
  expect(recordingOutput(" RUN v5\n Start at 12:34:56\n Tests 2 passed\n", "recording-fixture/project")).toBe("RUN v5\n Tests 2 passed")
})

test("recording output preserves messages that begin with Start at", () => {
  expect(recordingOutput("Start at the entrance", "recording-fixture/project")).toBe("Start at the entrance")
})
