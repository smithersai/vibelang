import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { probe } from "./out/main.js"

const sidecar = readFileSync(new URL("./main.d.vibe.ts", import.meta.url), "utf8")
for (const literal of [
  "`a\n//# sourceMappingURL=keep\nz`",
  '`a\n/// <reference path="./keep.d.ts" />\nz`',
  "`a${T}\n//# sourceMappingURL=keep\nz`",
]) assert.ok(sidecar.includes(literal), sidecar)
assert.ok(!sidecar.includes("sourceMappingURL=main.d.ts.map"), sidecar)
console.log(probe())
