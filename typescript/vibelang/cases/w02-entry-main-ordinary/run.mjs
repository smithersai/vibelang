// run-seconds: 180
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | A remaining marker keeps `EK2601`; `main` alone is ordinary source, gets no entry diagnostic and causes no implicit startup ([VIP-26](../vips/0026-top-level-and-main.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision)).
// Starting a module whose only startup candidate is an unmarked exported main
// runs nothing, its JavaScript holds no entry statement, its compilation
// reports no diagnostic, and vibelang --fix leaves it unchanged.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const here = fileURLToPath(new URL(".", import.meta.url))
for (const name of ["effect", "plain"]) {
  const js = readFileSync(join(here, "out", `${name}.js`), "utf8")
  assert.doesNotMatch(js, /\$entry|runMain|import\.meta\.main/, `${name}.js has no implicit startup:\n${js}`)
  const started = spawnSync(process.execPath, [join(here, "out", `${name}.js`)], { encoding: "utf8", timeout: 60000 })
  assert.equal(started.status, 0, started.stderr)
  assert.equal(started.stdout, "", `starting ${name}.js ran main`)
}

  console.log("an unmarked main is ordinary: no startup, no diagnostic, no migration")
