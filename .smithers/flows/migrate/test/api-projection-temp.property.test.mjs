import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const implementation = new URL("../lib/api-projection.mjs", import.meta.url).href
const compilerApi = new URL("../../../../docs/tools/package.json", import.meta.url).href
const rule = "Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin"

// A fresh process isolates os.tmpdir() and the target's working directory.
const child = `
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { isAbsolute, join, relative, resolve } from "node:path"
const [input, implementation, compilerApi] = process.argv.slice(1)
const shape = JSON.parse(input)
const ts = createRequire(compilerApi)("typescript")
const { apiProjection } = await import(implementation)
const temporary = shape.absolute ? resolve(shape.temporary) : shape.temporary
mkdirSync(temporary, { recursive: true })
process.env.TMPDIR = temporary
mkdirSync("original")
const file = shape.module + ".d.ts"
const text = "/** Stable public documentation. */ export interface Value { value: string }\\n"
writeFileSync(join("original", file), text)
const surface = { apiMetadata: {
  packageDir: resolve("original"), manifest: { types: "./" + shape.layout + "/" + file },
  logicalPaths: { [file]: shape.layout + "/" + file },
  aliases: { ["src/" + shape.module + ".ts"]: file }
} }
const projection = apiProjection(ts, resolve("original"), surface, [file])
try {
  assert.equal(isAbsolute(projection.directory), true)
  assert.equal(readFileSync(join(projection.directory, shape.layout, file), "utf8"), text)
  assert.equal(projection.originals.get(shape.layout + "/" + file), file)
  assert.equal(projection.destinations.get(file), shape.layout + "/" + file)
  assert.match(readFileSync(join(projection.directory, "src", file), "utf8"), /export \\* from/)
} finally { projection.cleanup() }
assert.equal(existsSync(projection.directory), false)
// Normalizing the temporary root must preserve rejection of real path escapes.
surface.apiMetadata.logicalPaths[file] = isAbsolute(shape.escape) ? shape.escape : relative(projection.directory, temporary) + "/../" + shape.escape
assert.throws(() => apiProjection(ts, resolve("original"), surface, [file]), /escapes its comparison projection/)
assert.deepEqual(readdirSync(temporary), [])
`

function check(shape) {
  const directory = mkdtempSync(join(resolve(tmpdir()), "api-projection-temp-"))
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", child, JSON.stringify(shape), implementation, compilerApi],
      { cwd: directory, encoding: "utf8", timeout: 15000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

const witness = { temporary: "tmp", layout: "dist", module: "entry", escape: "../outside.d.ts", absolute: false }
test("declaration projection accepts a relative temporary directory", () => check(witness))
test("absolute temporary directories keep declaration aliases and cleanup", () => check({ ...witness, absolute: true }))
test("property: temporary directory spelling preserves the declaration projection and its containment guard", () => checkProperty(fc, {
  name: "api-projection-temp", rule,
  command: "node --test .smithers/flows/migrate/test/api-projection-temp.property.test.mjs",
  regressions: new URL("./corpus/", import.meta.url), numRuns: 64,
  arbitrary: fc.record({
    temporary: fc.constantFrom("tmp", "./tmp", "tmp space", "nested/tmp"),
    layout: fc.constantFrom("dist", "lib", "output/types"),
    module: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    escape: fc.constantFrom("../outside.d.ts", "../../outside.d.ts", "/outside.d.ts"),
    absolute: fc.boolean()
  }),
  check
}))
