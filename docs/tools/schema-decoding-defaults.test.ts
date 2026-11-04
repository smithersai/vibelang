import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { command, defaultCompiler, extract, linkModules } from "./check-snippets"

async function compile(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "docs-schema-default-"))
  try {
    linkModules(dir)
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    writeFileSync(join(dir, "main.vibe"), source)
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, exactOptionalPropertyTypes: true, module: "NodeNext", target: "ESNext", skipLibCheck: true, types: [], outDir: "out" },
      files: ["main.vibe"]
    }))
    const result = await command([defaultCompiler(), "--singleThreaded", "--pretty", "false", "-p", "tsconfig.json"], dir, 30000)
    return { dir, result }
  } catch (cause) { rmSync(dir, { recursive: true, force: true }); throw cause }
}
async function oracle(dir: string, source: string) {
  writeFileSync(join(dir, "oracle.mjs"), source)
  return command(["node", "oracle.mjs"], dir, 30000)
}

test("the exact decoding-default example compiles and keeps its documented outputs", async () => {
  const page = readFileSync(new URL("../user/src/schema/089-advanced-usage.md", import.meta.url), "utf8")
  const block = extract(page).find(block => block.source.includes("const WithDecodeDefault"))
  expect(block).toBeDefined()
  const fixture = await compile(block!.source + "\nexport { Presence, WithDecodeDefault }\n")
  try {
    expect(fixture.result).toMatchObject({ exitCode: 0 })
    const result = await oracle(fixture.dir, 'import assert from "node:assert/strict"; import { Effect, Schema } from "effect"; import { Presence, WithDecodeDefault as S } from "./out/main.js";\n' +
      'assert.equal(Schema.is(Presence)({requiredUndefined:undefined,requiredNullable:null}),true);\n' +
      'assert.equal(Schema.is(Presence)({exact:undefined,requiredUndefined:undefined,requiredNullable:null}),false);\n' +
      'assert.deepEqual(Effect.runSync(Schema.decodeUnknownEffect(S)({copies:undefined})),{copies:1,rank:0});\n' +
      'assert.equal(Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(S)({rank:undefined})))._tag,"SchemaError");')
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" })
  } finally { rmSync(fixture.dir, { recursive: true, force: true }) }
})

test("decoding defaults are cold Effects and key defaults keep undefined distinct", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: -99, max: 99 }), async value => {
    const effectValue = 'let count = 0;\nexport function reads(): number { return count }\nexport const S = Schema.Struct({\n' +
      'copies: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultType(effect { count++; return ' + value + ' })),\n' +
      'rank: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultTypeKey(effect { count++; return ' + (value + 1) + ' }))\n})'
    const positive = await compile(effectValue)
    try {
      expect(positive.result).toMatchObject({ exitCode: 0 })
      const result = await oracle(positive.dir, 'import assert from "node:assert/strict"; import {Effect,Schema} from "effect"; import {S,reads} from "./out/main.js";\n' +
        'const decode = input => Effect.runSync(Schema.decodeUnknownEffect(S)(input));\n' +
        'assert.equal(reads(),0); assert.deepEqual(decode({}),{copies:' + value + ',rank:' + (value + 1) + '}); assert.equal(reads(),2);\n' +
        'assert.deepEqual(decode({copies:"' + (value + 2) + '",rank:"' + (value + 3) + '"}),{copies:' + (value + 2) + ',rank:' + (value + 3) + '}); assert.equal(reads(),2);\n' +
        'assert.deepEqual(decode({copies:undefined}),{copies:' + value + ',rank:' + (value + 1) + '});\n' +
        'assert.equal(Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(S)({rank:undefined})))._tag,"SchemaError");')
      expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" })
    } finally { rmSync(positive.dir, { recursive: true, force: true }) }
    const negative = await compile('const S = Schema.Struct({ copies: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultType(() => ' + value + ')), rank: Schema.FiniteFromString.pipe(Schema.withDecodingDefaultTypeKey(() => ' + (value + 1) + ')) })')
    try {
      expect(negative.result.exitCode).not.toBe(0)
      expect(negative.result.stdout.match(/TS2345/g)).toHaveLength(2)
    } finally { rmSync(negative.dir, { recursive: true, force: true }) }
  }), { numRuns: 8, seed: 89013 })
}, 60000)
