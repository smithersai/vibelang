import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = new URL("../user/src/platform/110-terminal.md", import.meta.url)

test("the terminal guide assigns raw mode to key input", () => {
  const text = readFileSync(page, "utf8")
  assert.equal(/line reader[^.]*raw mode/.test(text), false, "readLine does not enable raw mode")
  assert.match(text, /`readInput`[^.]*raw mode/)
})

for (const mode of ["readLine", "readInput"]) {
  test(`Node terminal ${mode} has the documented raw-mode lifetime`, () => {
    const source = `
      import assert from "node:assert/strict"
      import { Effect, Queue } from "effect"
      import * as NodeTerminal from "@effect/platform-node/NodeTerminal"
      const raw = []
      Object.defineProperty(process.stdin, "isTTY", { value: true })
      process.stdin.setRawMode = (enabled) => { raw.push(enabled); return process.stdin }
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const terminal = yield* NodeTerminal.make()
        if (${JSON.stringify(mode)} === "readLine") {
          assert.equal(yield* terminal.readLine, "Ada")
        } else {
          const keys = yield* terminal.readInput
          const key = yield* Queue.take(keys)
          assert.equal(key.input.value, "A")
        }
      })))
      assert.deepEqual(raw, ${mode === "readLine" ? "[]" : "[true, false]"})
    `
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: new URL(".", import.meta.url), input: "Ada\n", encoding: "utf8", timeout: 10000
    })
    assert.equal(result.status, 0, result.stderr || String(result.error))
  })
}
