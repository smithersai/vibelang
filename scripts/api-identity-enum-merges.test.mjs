import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const compilerOptions = { lib: ["lib.es5.d.ts"] }
const quote = "each export's type identical to `tsc`'s in both directions (a type-level check)"
test("enum merge identity oracle remains quoted in the specification", () => {
  assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(quote))
})

function compare(before, after = before) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-enum-merges-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, side))
      for (const [name, text] of Object.entries(typeof files === "string" ? { "index.d.ts": files } : files))
        writeFileSync(join(root, side, name), text)
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), { compilerOptions })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function identical(before, after = before) {
  const result = compare(before, after)
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
}
function different(before, after, kind = "typeDifferences") {
  const result = compare(before, after)
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result[kind].length, JSON.stringify(result))
}

test("enum with a helper namespace compares identical and retains member values", () => {
  const text = "export declare enum E { A = 0 }\nexport declare namespace E { function parse(s: string): E }"
  identical(text)
  different(text, text.replace("A = 0", "A = 1"))
  different(text, text.replace("s: string", "s: number"))
  const mutable = text.replace("function parse(s: string): E", "let version: 1")
  different(mutable, mutable.replace("let version", "const version"))
})

test("repeated enum declarations compare identical and retain every member", () => {
  const text = "export declare enum E { A = 0 }\nexport declare enum E { B = 1 }"
  identical(text)
  identical(text, "export declare enum E { A = 0, B = 1 }")
  different(text, text.replace("B = 1", "B = 2"))
})

test("type-only and nested helper namespaces retain enum member and reverse-map types", () => {
  for (const helper of ["type Input = string", "function parse(s: string): E"]) {
    const body = `enum E { A = -1 } enum E { B = 2 } namespace E { ${helper} }
      type Member = E.B; type Reverse = (typeof E)[number];`
    identical("export declare namespace Outer { " + body + " }")
    const top = body.replace(/\b(enum|namespace) E/g, "declare $1 E")
    identical(top + " export { E };")
    identical(top + " export = E;")
  }
})

test("global enum merges span declaration files", () => {
  const files = {
    "a.d.ts": "declare enum E { A = 0 }",
    "b.d.ts": "declare enum E { B = 1 }",
    "index.d.ts": "declare namespace E { function parse(s: string): E }\nexport { E };",
  }
  identical(files)
  different(files, { ...files, "b.d.ts": "declare enum E { B = 2 }" })
  const documented = { ...files, "b.d.ts": "/** Extra values. */\ndeclare enum E {\n /** Original member. */\n B = 1 }" }
  identical(documented)
  different(documented, { ...documented, "b.d.ts": documented["b.d.ts"].replace("Original", "Changed") }, "docDifferences")
  different(documented, { ...documented, "b.d.ts": documented["b.d.ts"].replace("Extra", "More") }, "docDifferences")
})

test("source enum namespaces retain identity", () => {
  const text = "export enum E { A = 0 }\nexport namespace E { export function parse(s: string): E { return E.A } }"
  identical({ "e.ts": text, "index.d.ts": 'export * from "./e.js";' })
})

test("enum helpers keep documentation and distinct enum identities checked", () => {
  const text = "export declare enum E {\n /** Original */\n A = 0 }\nexport declare namespace E { function parse(s: string): E }"
  different(text, text.replace("Original", "Changed"), "docDifferences")
  const enums = "export declare enum E { A = 0 } export declare enum F { A = 0 }"
  different(enums + " export declare const value: E;", enums + " export declare const value: F;")
})

test("enum value queries keep numeric index types through imports", () => {
  const files = {
    "e.d.ts": "export declare enum E { A = 1 } export declare namespace E { function parse(): E }",
    "index.d.ts": 'import { E } from "./e.js"; export type Reverse = (typeof E)[number]; export type ImportReverse = (typeof import("./e.js").E)[number]; export type Keys = keyof typeof E;',
  }
  identical(files)
})

test("same-named enums in separate namespace symbols keep distinct identities", () => {
  const declarations = "export declare namespace Left { enum E { A = 0 } } export declare namespace Right { enum E { A = 0 } }"
  identical(declarations)
  different(declarations + " export declare const value: Left.E;", declarations + " export declare const value: Right.E;")
})

function merged({ values, split, helper, nested, stringValues }) {
  const prefix = nested ? "" : "declare "
  const member = (value, i) => `M${i} = ${stringValues ? JSON.stringify("v" + value) : value}`
  const declarations = split
    ? values.map((value, i) => `${prefix}enum E { ${member(value, i)} }`).join("\n")
    : `${prefix}enum E { ${values.map(member).join(", ")} }`
  const helpers = helper === "value" ? prefix + "namespace E { function parse(s: string): E; const version: 1 }"
    : helper === "type" ? prefix + "namespace E { type Input = string }" : ""
  const text = declarations + "\n" + helpers + "\ntype Member = E.M0;"
  return nested ? "export declare namespace Outer { " + text + " }" : text + "\nexport { E };"
}

test("property: enum merge partitions preserve identity and value mutations differ", async () => {
  await checkProperty(fc, {
    name: "api-identity-enum-merges",
    rule: "Chapter 1, Declaration output, API identity: " + quote,
    command: "node --test scripts/api-identity-enum-merges.test.mjs",
    arbitrary: fc.record({
      values: fc.array(fc.integer({ min: -10, max: 10 }), { minLength: 2, maxLength: 4 }),
      split: fc.boolean(), helper: fc.constantFrom("none", "type", "value"),
      nested: fc.boolean(), stringValues: fc.boolean(),
    }),
    numRuns: 16,
    check: input => {
      const text = merged(input)
      identical(text)
      identical(text, merged({ ...input, split: !input.split }))
      different(text, merged({ ...input, values: input.values.map((value, i) => i ? value : value + 1) }))
    },
  })
})
