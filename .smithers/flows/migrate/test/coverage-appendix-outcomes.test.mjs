import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertBaselineSafe } from "../lib/baseline.mjs"

const checkUnknown = () => {
  const directory = mkdtempSync(join(tmpdir(), "cov900-outcome-"))
  try {
    const baseline = join(directory, "baseline")
    mkdirSync(baseline)
    const write = (name, value) => writeFileSync(join(baseline, name), JSON.stringify(value))
    const original = { compiler: "before", code: 0, diagnostics: [] }
    write("upstream-checks.json", { ".": original })
    write("upgraded-checks.json", { ".": original })
    write("compile-root.json", [])
    const result = assertBaselineSafe({ baseline, upgrade: join(directory, "upgrade.json"), setup: join(directory, "setup.json") })
    assert.notEqual(result.state, "accepted", "missing compile-root.exit.json is an unverified stage, not inherited success")
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
// Chapter 900: old receipts without a stage outcome must not borrow a zero exit.
// docs/design/src/900-appendices.md#ec621828739d88fb — Chapter 900: unknown legacy setup outcome cannot inherit success.
// docs/design/src/900-appendices.md#97fe4d5b170cb165 — Chapter 900: unknown legacy setup outcome cannot inherit success.
// docs/design/src/900-appendices.md#d68e883b221ef8f1 — Chapter 900: unknown legacy setup outcome cannot inherit success.
test.todo("Chapter 900: a missing setup outcome remains unverified", checkUnknown)
