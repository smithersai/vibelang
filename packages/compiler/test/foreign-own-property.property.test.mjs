import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const binary = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-history-foreign-typeof-property.json", import.meta.url), "utf8"))
function witness({ key, form, readonly, optional }) {
  assert.ok(existsSync(binary), "build the compiler before checking own-signature properties")
  const root = mkdtempSync(join(tmpdir(), "vibelang-own-property-"))
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "foreign.ts"), "export async function task(): Promise<void> {}\n")
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", allowImportingTsExtensions: true, noEmit: true, types: [] },
      vibe: { effectGlobals: false, effectModules: false }, files: ["main.vibe", "foreign.ts"]
    }))
    const member = (readonly ? "readonly " : "") + key + (optional ? "?" : "") + ": typeof task"
    const value = key === "task" ? "{task}" : "{" + key + ": task}"
    const body = form === "satisfies" ? "export const ports = " + value + " satisfies {" + member + "}" :
      form === "nested" ? "export interface Ports { inner: {" + member + "} }; export const ports: Ports = {inner: " + value + "}" :
      "export interface Ports {" + member + "}; export const ports: Ports = " + value
    const run = (text) => {
      writeFileSync(join(root, "main.vibe"), 'import {task} from "./foreign.ts"\n' + text)
      return spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 15000 })
    }
    const own = run(body)
    assert.equal(own.status, 0, own.stdout + own.stderr)
    const other = run("export interface Ports {" + (readonly ? "readonly " : "") + key + (optional ? "?" : "") + ": () => Promise<void>}; export const ports: Ports = " + value)
    assert.equal(other.status, 2, other.stdout + other.stderr)
    assert.equal((other.stdout.match(/error EK0402:/g) ?? []).length, 1, other.stdout + other.stderr)
    assert.doesNotMatch(other.stdout, /error (?:TS|EK(?!0402))/)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("an interface property retains its foreign callable's own type query", () => witness(corpus))
test("own-signature properties preserve admission across object shapes", () => {
  fc.assert(fc.property(fc.record({
    key: fc.constantFrom("task", "run", "execute", "$task"),
    form: fc.constantFrom("interface", "satisfies", "nested"),
    readonly: fc.boolean(), optional: fc.boolean()
  }), witness), { seed: 20261109, numRuns: 24 })
})
