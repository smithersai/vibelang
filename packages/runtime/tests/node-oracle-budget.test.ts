import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

test("generated compatibility checks bound real Node startups while retaining all comparisons", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-oracle-budget-"))
  try {
    const bin = join(root, "bin")
    mkdirSync(bin)
    const count = join(root, "count")
    const metrics = join(root, "metrics")
    writeFileSync(count, "")
    writeFileSync(join(bin, "node"), '#!/bin/sh\nprintf "launched\\n" >> "$ORACLE_COUNT"\nexec "$ORACLE_REAL_NODE" "$@"\n', { mode: 0o755 })
    const real = Bun.which("node")
    expect(real).not.toBeNull()
    const child = Bun.spawn(["bun", "test", "--timeout", "30000",
      "tests/experimental-net-address.test.ts", "tests/experimental-encoding.test.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PATH: bin + ":" + process.env.PATH, ORACLE_COUNT: count, ORACLE_REAL_NODE: real!, NODE_ORACLE_METRICS: metrics },
      stdout: "pipe", stderr: "pipe"
    })
    const [status, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(status, stdout + stderr).toBe(0)
    expect(stderr + stdout).toContain("8 pass")
    const launches = readFileSync(count, "utf8").trim().split("\n").filter(Boolean).length
    expect(launches).toBeGreaterThan(0)
    expect(launches).toBeLessThanOrEqual(8)
    const receipts = readFileSync(metrics, "utf8").trim().split("\n").map(line => JSON.parse(line))
    expect(receipts.length).toBe(launches)
    const requests: Record<string, number> = { ipv6: 0, base64: 0 }
    for (const receipt of receipts) requests[receipt.kind] += receipt.requests
    expect(requests).toEqual({ ipv6: 252, base64: 207 })
    expect(receipts.reduce((total, receipt) => total + receipt.comparedInputs, 0)).toBeGreaterThanOrEqual(459)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 120_000)
