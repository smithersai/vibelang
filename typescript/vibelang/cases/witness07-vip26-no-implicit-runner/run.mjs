import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
for (const file of ["out/main.js", "out/plain.js"]) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { encoding: "utf8", timeout: 30000 })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, "", `${file}: an ordinary main ran without a runner`)
}
// You call a runner yourself, exactly as in Effect TS.
const { main } = await import("./out/main.js")
await Effect.runPromise(main())
