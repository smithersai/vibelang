import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const experiments = createRequire(new URL("../../experiments/package.json", import.meta.url))
const effectModule = experiments.resolve("effect")

function reproduce(file: string) {
  const markdown = readFileSync(new URL(file, import.meta.url), "utf8")
  const code = markdown.match(/^```ts\n([\s\S]+?)^```$/m)?.[1]
  if (!code) throw new Error(`Missing TypeScript reproduction in ${file}`)
  expect(markdown).toContain("**Status:** withdrawn, never filed.")
  const script = code.replace('from "effect"', `from ${JSON.stringify(effectModule)}`)
  const result = Bun.spawnSync([process.execPath, "--eval", script])
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return result.stdout.toString().trim()
}

test("typed recovery retains the cleanup defect on the pinned Effect", () => {
  const output = reproduce("effect-catch-mixed-causes.md")
  expect(output.split("\n").at(-1)).toBe("Failure")
  expect(output.split("\n")[0].match(/Die/g)).toHaveLength(2)
})

test("one traced interruption records one reason and one interruptor", () => {
  expect(reproduce("effect-interrupt-reasons.md")).toBe("1\n1")
})
