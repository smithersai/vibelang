// The shared helper prints "explicit and native member declarations are stable". This case holds it to
// that: when a member is readonly in one spelling and writable in the other, it must report that member
// and not print the claim; when the spellings declare different members, it must throw.
import assert from "node:assert/strict"
import fs from "node:fs"
import { checkMemberReadonlyUpgrade } from "../../member-readonly-upgrade.mjs"

const input = fs.readFileSync(new URL("./input.txt", import.meta.url), "utf8")
const printed = []
const log = console.log
function upgrade(name, legacy) {
  const root = new URL("./out/" + name + "/", import.meta.url)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(new URL("input.txt", root), input)
  fs.writeFileSync(new URL("legacy.txt", root), legacy)
  printed.length = 0
  console.log = line => printed.push(line)
  try { return checkMemberReadonlyUpgrade(root) } finally { console.log = log }
}

assert.deepEqual(upgrade("same", input), [])
assert.deepEqual(printed, ["explicit and native member declarations are stable"])
for (const [name, from, to, difference] of [
  ["interface-member", "export interface I { value:", "export interface I { readonly value:", "value: explicit readonly, native writable"],
  ["dropped-readonly", "readonly fixed: number", "fixed: number", "fixed: explicit writable, native readonly"],
  ["class-member", "export class C { value:", "export class C { readonly value:", "value: explicit readonly, native writable"],
]) {
  assert.ok(input.includes(from), name)
  const differences = upgrade(name, input.replace(from, to))
  assert.equal(differences.length, 1, name + ": " + JSON.stringify(differences))
  assert.ok(differences[0].endsWith(" " + difference), name + ": " + differences[0])
  assert.deepEqual(printed, [differences[0], "explicit and native member declarations differ in readonly only at the members above"], name)
}
assert.throws(() => upgrade("renamed", input.replace("readonly fixed: number", "readonly other: number")), /declare different members/)
console.log("a readonly difference between the explicit and native spellings is reported, never called stable")
