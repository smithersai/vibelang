import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const { CaseCommands } = await import(process.env.CASE_COMMANDS_MODULE ?? new URL("../typescript/vibelang/harness-command.mjs", import.meta.url))

async function capture(t, bytes, code = 0) {
  const root = mkdtempSync(join(tmpdir(), "harness utf8 "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, "output.bin")
  writeFileSync(file, bytes)
  const commands = new CaseCommands()
  const result = await commands.run(process.execPath, ["-e", `
    const bytes = require("node:fs").readFileSync(process.argv[1])
    process.stdout.write(bytes)
    process.stderr.write(bytes, () => { process.exitCode = Number(process.argv[2]) })
  `, file, String(code)], { phase: "unicode output", timeout: 60_000 })
  const expected = bytes.toString("utf8")
  assert.equal(result.code, code)
  assert.ok(result.stdout === expected, "stdout must decode the whole UTF-8 byte sequence")
  assert.ok(result.stderr === expected, "stderr must decode the whole UTF-8 byte sequence")
  const record = commands.records[0]
  assert.equal(record.timedOut, false)
  assert.equal(record.exitCode, code)
  assert.equal(record.stdoutTail, expected.slice(-16_384))
  assert.equal(record.stderrTail, expected.slice(-16_384))
}

// A pipe read can end at any byte. Prefixes shift each multi-byte character
// across common read boundaries; output exceeds the OS pipe buffer.
for (const [name, symbol] of [["ASCII", "a"], ["two-byte", "é"], ["three-byte", "漢"], ["four-byte", "𐐷"]]) {
  for (let prefix = 0; prefix < Buffer.byteLength(symbol); prefix++) {
    test(`${name} output with ${prefix}-byte prefix survives pipe boundaries`, t => {
      const text = "x".repeat(prefix) + symbol.repeat(100_000) + "\nend\n"
      return capture(t, Buffer.from(text))
    })
  }
}

test("generated mixed Unicode output preserves both streams and tails on error exits", async t => {
  let state = 0x718551
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
  const symbols = ["a", "é", "€", "漢", "𐐷", "🙂", "\n", "\0", "e\u0301"]
  for (let n = 0; n < 24; n++) {
    const prefix = "p".repeat(next() % 17)
    const pattern = Array.from({ length: 29 }, () => symbols[next() % symbols.length]).join("")
    const bytes = Buffer.from(prefix + pattern.repeat(5000) + "終\n")
    await capture(t, bytes, n % 2 ? 7 : 0)
  }
})

test("empty, malformed and truncated UTF-8 retain whole-buffer decoding semantics", async t => {
  for (const tail of [[], [0xc3], [0xe2], [0xe2, 0x82], [0xf0], [0xf0, 0x90], [0xf0, 0x90, 0x90], [0xff, 0x61, 0x80]]) {
    await capture(t, Buffer.from(tail))
    // Also exercise decoder flushing after several full pipe buffers.
    await capture(t, Buffer.concat([Buffer.from("漢".repeat(100_000)), Buffer.from(tail)]))
  }
})
