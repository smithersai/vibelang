import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

for (const file of ["e2e.sh", "parity/run.sh"]) {
  test(`${file} references existing Go overlay inputs`, () => {
    const script = new URL(file, import.meta.url)
    const text = readFileSync(script, "utf8")
    for (const [, relative] of text.matchAll(/"\$here\/([^"\n]+\.go)"/g)) {
      assert.ok(existsSync(new URL(relative, script)), `${file} references missing Go input ${relative}`)
    }
  })
}
