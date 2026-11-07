// TypeScript 5.9.3 and 7.0.2 write the reverse mapped type met again as
// /*elided*/ any without TS5088; the harness has already required that the
// case compiles without errors.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const read = name => readFileSync(new URL(name, import.meta.url), "utf8")
for (const name of ["out/reversed.d.ts", "out/reversed-vibe.d.ts"]) assert.match(read(name), /self: \/\*elided\*\/ any;/, name)
// main.vibe declares what TypeScript 7.0.2 declares for lib.ts (expected/lib.d.ts),
// plus the @throws {never} tags VIP-27 adds to a .vibe file's plain callables.
assert.equal(read("out/main.d.ts").replace(/^ *\/\*\* @throws \{never\} \*\/\n/gm, ""), read("expected/lib.d.ts"))
console.log("anonymous cycles elided")
