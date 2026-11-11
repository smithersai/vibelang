import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

for (const name of ["main", "helper"]) {
  assert.equal(
    readFileSync(new URL(`./out/${name}.d.ts`, import.meta.url), "utf8"),
    readFileSync(new URL(`./typescript/out/${name}.d.ts`, import.meta.url), "utf8"),
  )
}
console.log("namespace type declarations match the TypeScript twin byte for byte")
