import { expect, test } from "bun:test"
import * as fc from "fast-check"
import { withNodeOracle } from "./node-oracle"

test("Node oracle keeps empty, escaped and consecutive requests separate", async () => {
  await withNodeOracle<boolean>("ipv6", async request => {
    expect(await request([])).toEqual([])
    expect(await request(["::1", "::1\n", "::1\0", "::1%é", "::1%eth0"])).toEqual([true, false, false, false, true])
    expect(await request(["127.0.0.1", "::"])).toEqual([false, true])
  })
  await withNodeOracle<number[]>("base64", async request => {
    expect(await request([])).toEqual([])
    expect(await request(["Zg==", "Zm8=", "Z\nm8=", ""])).toEqual([[102], [102, 111], [102, 111], []])
    expect(await request(["!$?", "Zm9v"])).toEqual([[], [102, 111, 111]])
  })
})

test("Node oracle serves real shrink attempts and remains usable after a property failure", async () => {
  await withNodeOracle<boolean>("ipv6", async request => {
    let calls = 0
    let failure: unknown
    try {
      await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async value => {
        calls++
        expect(await request(["::1"])).toEqual([true])
        return value < 1
      }), { seed: 32147, numRuns: 1 })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain("Shrunk")
    expect(calls).toBeGreaterThan(1)
    expect(await request(["::"])).toEqual([true])
  })
})

test("Node oracle cleanup preserves a caller's original failure", async () => {
  const marker = new Error("original property failure")
  await expect(withNodeOracle<boolean>("ipv6", async request => {
    expect(await request(["::1"])).toEqual([true])
    throw marker
  })).rejects.toBe(marker)
})
