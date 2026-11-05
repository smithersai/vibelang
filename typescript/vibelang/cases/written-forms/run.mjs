import assert from "node:assert/strict"
import { existsSync } from "node:fs"
// VIP-27 and VIP-4 carry foreign-call contracts in declarations; VIP-36 is open.
assert.equal(existsSync(new URL("./out/vibelang.manifest.json", import.meta.url)), false,
  "ordinary declaration builds must not emit the retired provenance manifest")
await import("./out/main.js")
