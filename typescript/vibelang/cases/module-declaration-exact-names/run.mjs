import assert from "node:assert/strict"
import fs from "node:fs"
import { result } from "./out/main.js"
assert.deepEqual(result, [1,2,3,4,5])
for (const name of ["-54-ext", "text", "caf-e9-", "cafe-301-", "-24-env"]) {
  for (const suffix of [".js", ".d.ts", ".js.map", ".d.ts.map"]) {
    assert.ok(fs.existsSync(new URL("./out/main.vibe." + name + suffix, import.meta.url)), name + suffix)
  }
}
console.log(JSON.stringify(result))
