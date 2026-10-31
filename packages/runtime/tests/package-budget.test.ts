import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// The import-order cases run bounded children sequentially. A shorter parent
// deadline kills a healthy slow startup before either child's own limit.
test("static-import cases budget more than all their bounded child processes", () => {
  const file = resolve(import.meta.dir, "package.test.ts")
  const source = readFileSync(file, "utf8")
  const start = source.indexOf("for (const kernelFirst of")
  const end = source.indexOf("for (const version of", start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  const block = source.slice(start, end)
  const calls = /for \(const executable of \[([^\]]+)\]\)/.exec(block)?.[1]
  const child = /Bun\.spawnSync\(\[executable,[\s\S]*?timeout: ([\d_]+)\s*\}/.exec(block)?.[1]
  const parent = /\}, ([\d_]+)\)/.exec(block)?.[1]
  expect(calls).toBeDefined()
  expect(child).toBeDefined()
  expect(parent, "the test must declare a parent deadline instead of inheriting Bun's five seconds").toBeDefined()
  const milliseconds = (text: string) => Number(text.replaceAll("_", ""))
  const count = calls!.split(",").length
  expect(milliseconds(parent!)).toBeGreaterThan(count * milliseconds(child!))
  expect(milliseconds(parent!)).toBeLessThanOrEqual(60_000)
})
