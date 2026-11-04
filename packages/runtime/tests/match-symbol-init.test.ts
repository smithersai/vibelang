// Matcher symbol initialization (008-runtime.md): "When the host lacks
// `Symbol.customMatcher`, runtime initialization defines an own property on the
// global `Symbol` with value `Symbol.for("Symbol.customMatcher")`, non-writable,
// non-enumerable and non-configurable, like a well-known symbol. A pre-existing
// host symbol is preserved with its native identity."
//
// Each scenario starts a fresh Node and Bun process, because the property can
// be defined only once per realm.
import { afterAll, expect, test } from "bun:test"
import fc from "fast-check"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "vibelang-matcher-symbol-"))
mkdirSync(join(root, "node_modules"))
symlinkSync(join(import.meta.dir, ".."), join(root, "node_modules", "vibelang-runtime"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const hosts = [["Node", "node"], ["Bun", process.execPath]] as const

type Host = { readonly registry: boolean; readonly description: string; readonly writable: boolean; readonly enumerable: boolean; readonly configurable: boolean }

let scripts = 0
// Runs the runtime's initialization after the host setup, and reports the
// global property's descriptor and how the runtime's export relates to it.
function observe(executable: string, host: Host | null) {
  const setup = host === null ? "" : `
const hostSymbol = ${host.registry ? "Symbol.for" : "Symbol"}(${JSON.stringify(host.description)})
Object.defineProperty(Symbol, "customMatcher", { value: hostSymbol, writable: ${host.writable}, enumerable: ${host.enumerable}, configurable: ${host.configurable} })
globalThis.hostSymbol = hostSymbol`
  const file = join(root, `probe-${scripts++}.mjs`)
  writeFileSync(file, `${setup}
const before = Object.getOwnPropertyDescriptor(Symbol, "customMatcher")
const { customMatcher } = await import("vibelang-runtime")
const d = Object.getOwnPropertyDescriptor(Symbol, "customMatcher")
console.log(JSON.stringify({
  hadBefore: before !== undefined,
  isSymbol: typeof d?.value === "symbol",
  registryKey: typeof d?.value === "symbol" ? Symbol.keyFor(d.value) ?? null : null,
  hostIdentity: globalThis.hostSymbol === undefined ? null : d?.value === globalThis.hostSymbol,
  exportIsKey: customMatcher === d?.value,
  writable: d?.writable, enumerable: d?.enumerable, configurable: d?.configurable,
}))
`)
  const result = Bun.spawnSync([executable, file], { cwd: root, timeout: 10_000 })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout.toString())
}

test("matcher symbol: a host without Symbol.customMatcher gets the registry key as a non-writable, non-enumerable, non-configurable own property", () => {
  for (const [name, executable] of hosts) {
    expect([name, observe(executable, null)]).toEqual([name, {
      hadBefore: false, isSymbol: true, registryKey: "Symbol.customMatcher", hostIdentity: null, exportIsKey: true,
      writable: false, enumerable: false, configurable: false,
    }])
  }
}, 35_000)

test("matcher symbol: a pre-existing host symbol keeps its identity and descriptor, and the runtime exports it", () => {
  fc.assert(fc.property(
    fc.record({ registry: fc.boolean(), description: fc.string({ maxLength: 12 }), writable: fc.boolean(), enumerable: fc.boolean(), configurable: fc.boolean() }),
    fc.constantFrom(...hosts),
    (host, [name, executable]) => {
      expect([name, observe(executable, host)]).toEqual([name, {
        hadBefore: true, isSymbol: true, registryKey: host.registry ? host.description : null, hostIdentity: true, exportIsKey: true,
        writable: host.writable, enumerable: host.enumerable, configurable: host.configurable,
      }])
    }), { seed: 80081, numRuns: 16 })
}, 120_000)
