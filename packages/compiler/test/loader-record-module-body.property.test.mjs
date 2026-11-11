// VIP-40 module bodies: a loader record written by a complete compile holds
// right after writeLoaderRecord, though that compile wrote each body's
// declaration x.vibe.<name>.d.ts after the record listed the directory. A file
// of that shape is an output only while its source declares that body, so a
// hand-written one for another name, a case twin, or a missing source is a
// new input and the record misses.
//
// The oracle is the specification's: the output stem encodes the declared
// name by the quoted rule, and discovery leaves the body's declaration out
// while its source declares that body. The compiler writes the declarations;
// the property checks their names against the encoding and the record against
// the discovery rule, for names with Unicode, escapes and case twins.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkLoaderRecord, writeLoaderRecord } from "../project.mjs"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const skip = !existsSync(native) && `run typescript/vibelang/smoke.sh first; missing ${native}`

const encodingRule = "Encoding keeps `a`–`z`, `0`–`9` and `_`; every other Unicode code point becomes `-`, its code point in lowercase hexadecimal without leading zeros, and `-`, without case folding or Unicode normalization."
const discoveryRule = "So is a [module body](001-functions.md#module-declarations)'s declaration written beside a sidecar, such as `src/main.vibe.parse.d.ts`, while its source declares that body"

test("module body record property quotes the output stem and discovery rules", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(encodingRule))
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(discoveryRule))
})

// The quoted encoding, over code points.
const encode = (name) => [...name].map((character) => /[a-z0-9_]/.test(character) ? character : `-${character.codePointAt(0).toString(16)}-`).join("")
// An identifier escape for the name's first code point.
const escaped = (name, braced) => {
  const [first, ...rest] = [...name]
  const code = first.codePointAt(0).toString(16)
  return (braced || code.length > 4 ? `\\u{${code}}` : `\\u${code.padStart(4, "0")}`) + rest.join("")
}

const nameArbitrary = fc.record({
  start: fc.constantFrom("M", "m", "_", "$", "Ü", "π", "中"),
  rest: fc.array(fc.constantFrom("a", "Z", "0", "_", "$", "é", "ß"), { maxLength: 3 }),
  escape: fc.constantFrom("none", "short", "braced"),
  gap: fc.constantFrom(" ", "\t", "  "),
  open: fc.constantFrom("", " ", "\n")
}).map((spec) => ({ ...spec, name: spec.start + spec.rest.join("") }))

const arbitrary = fc.record({
  bodies: fc.uniqueArray(nameArbitrary, { minLength: 1, maxLength: 3, selector: (body) => body.name }),
  layout: fc.constantFrom("beside", "sidecarDir"),
  decoy: fc.constantFrom("undeclared", "caseTwin", "otherSource")
})

async function check({ bodies, layout, decoy }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-body-property-")))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true, type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { module: "nodenext", strict: true, skipLibCheck: true, types: [], rootDir: "." },
      include: ["."], ...(layout === "sidecarDir" ? { vibe: { sidecarDir: "types" } } : {})
    }))
    const source = bodies.map((body, index) => {
      const written = body.escape === "none" ? body.name : escaped(body.name, body.escape === "braced")
      return `module${body.gap}${written}${body.open}{\n  export const v${index}: number = ${index}\n}\n`
    }).join("") + bodies.map((body, index) => `export { v${index} } from ${body.name}\n`).join("")
    writeFileSync(join(root, "src/main.vibe"), source)
    await sleep(1500) // past the record's margin, as a checked-out tree is
    const project = join(root, "tsconfig.json")
    const written = writeLoaderRecord({ project, root, compiler: native })
    assert.equal(written.modules, 1 + bodies.length, JSON.stringify({ written, source }))
    const at = join(root, layout === "sidecarDir" ? "types/src" : "src")
    const declared = bodies.map((body) => `main.vibe.${encode(body.name)}.d.ts`)
    const emitted = readdirSync(at).filter((name) => name.startsWith("main.vibe.") && name.endsWith(".d.ts"))
    assert.deepEqual(emitted.sort(), [...declared].sort(), "body declaration names follow the quoted encoding")
    assert.deepEqual(checkLoaderRecord({ project, root, compiler: native }), { modules: 1 + bodies.length }, source)
    const name = bodies[0].name
    const twin = name.replace(/[A-Za-z]/, (letter) => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase())
    const other = decoy === "caseTwin" && twin !== name && !bodies.some((body) => body.name === twin) ? twin : name + "Q"
    const file = decoy === "otherSource" ? `other.vibe.${encode(name)}.d.ts` : `main.vibe.${encode(other)}.d.ts`
    writeFileSync(join(at, file), "export declare const decoy: number\n")
    assert.match(checkLoaderRecord({ project, root, compiler: native }).miss ?? "", /gained or lost a file/, `${file} is an input`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("loader records treat module body declarations as outputs", { skip }, async () => {
  await checkProperty(fc, {
    name: "loader-record-module-body",
    rule: `001-functions.md: ${encodingRule} 007-tooling.md: ${discoveryRule}`,
    command: "node --test test/loader-record-module-body.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url),
    numRuns: 6,
    arbitrary,
    check
  })
})
