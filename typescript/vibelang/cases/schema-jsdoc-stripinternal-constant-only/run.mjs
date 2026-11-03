import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"

const require = createRequire(import.meta.url)
const tsc = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
for (const source of ["out/main.d.ts", "typescript/out/main.d.ts"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-strip-consumer-"))
  try {
    fs.copyFileSync(source, path.join(dir, "generated.d.ts"))
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}')
    fs.symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"))
    fs.writeFileSync(path.join(dir, "consumer.ts"), 'import type { Message } from "./generated.js"; export type Stripped = Message;')
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", lib: ["ESNext", "DOM"], module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: false, types: [], noEmit: true },
      files: ["consumer.ts"]
    }))
    const result = spawnSync(process.execPath, [tsc, "-p", dir, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
    const output = result.stdout + result.stderr
    assert.notEqual(result.status, 0, source + ": native stripped value must remain a consumer error")
    assert.deepEqual([...new Set([...output.matchAll(/error (TS[0-9]+)/g)].map(m => m[1]))], ["TS2693"], output)
    assert.match(output, /Message/, output)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
console.log("native stripInternal consumer limitation agrees")
