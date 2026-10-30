import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { kernelSuiteDeadline } from "./kernel-facts"

// //:site-contrast runs only after merge, so a timeout its stages outgrow
// lands unseen. This check runs in //:docs-tools, before merge.
const minutes = (text: string) => Number(/^(\d+)m$/.exec(text)?.[1]) * 60_000

test("the site contrast test's timeout covers the kernel suite and fits the target's timeout", () => {
  const repo = resolve(import.meta.dir, "../..")
  const source = readFileSync(resolve(import.meta.dir, "site-contrast.test.ts"), "utf8")
  const literal = /\}, ([\d_ *]+)\)\s*$/.exec(source)?.[1]
  expect(literal).toMatch(/^[\d_ *]+$/)
  const timeout = literal!.replaceAll("_", "").split("*").reduce((product, factor) => product * Number(factor), 1)
  const target = /"site-contrast": S\.Shell\.Test\(\{[^}]*timeout: "(\d+m)"/.exec(readFileSync(resolve(repo, "PACKAGE.ts"), "utf8"))?.[1]
  expect(target).toBeDefined()
  // npm ci, typecheck, the rest of the build and the browser check take about 5 minutes on a loaded host.
  expect(timeout).toBeGreaterThanOrEqual(kernelSuiteDeadline + 5 * 60_000)
  expect(timeout).toBeLessThan(minutes(target!))
})
