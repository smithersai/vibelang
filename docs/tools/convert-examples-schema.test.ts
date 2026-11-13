import { test } from "bun:test"
import { expect, join, createRequire, cases, withExample } from "./convert-examples-fixture"


// docs/design/src/006-data.md: an optional field with an explicit undefined
// union maps to Schema.optional under either exactOptionalPropertyTypes setting.
test("schema conversion preserves optional undefined under both TypeScript settings", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  const example = cases().find((item: { name: string }) => item.name === "06-shipment-schema")!
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[a-z]{2,12}$/).filter((key: string) => !["tracking", "weight", "stage"].includes(key)), fc.string(), async (key: string, value: string) => {
    const mutate = (source: string) => source.replace(/\bnote\b/g, key)
    const keyCode = JSON.stringify(key)
    const runner = [
      'import { Schema } from "effect";',
      'import { Shipment } from "./out/main.js";',
      'const key = ' + keyCode + ';',
      'const base = { tracking: "PK-9", weight: 3, stage: "sent" };',
      'const inputs = [base, {...base, [key]:undefined}, {...base, [key]:' + JSON.stringify(value) + '}, {...base, [key]:7}];',
      'console.log(JSON.stringify(inputs.map(input => {',
      '  try { const decoded = Schema.decodeUnknownSync(Shipment)(input); return { valid:true, own:Object.hasOwn(decoded,key), value:decoded[key] } }',
      '  catch { return {valid:false} }',
      '})));'
    ].join("\n")
    const expected = JSON.stringify([
      {valid:true,own:false}, {valid:true,own:true}, {valid:true,own:true,value}, {valid:false}
    ]) + "\n"
    const usage = '\nconst explicitUndefined: Shipment = { tracking:"PK-9", weight:3, stage:"sent", [' + keyCode + ']:undefined };\n'
    for (const exactOptionalPropertyTypes of [false,true]) {
      const options = {exactOptionalPropertyTypes}
      expect(await withExample(mutate(example.input) + usage, "ts", runner, options)).toBe(expected)
      expect(await withExample(mutate(example.expected) + usage, "vibe", runner, options)).toBe(expected)
    }
  }), {numRuns:6,seed:4075,examples:[["note","fragile"]]})
}, 180000)
