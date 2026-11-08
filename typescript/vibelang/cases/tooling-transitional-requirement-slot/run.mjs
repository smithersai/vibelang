// EK4853: an omitted requirement slot is a warning; both fix scopes write the
// requirements the retired rule inferred, and an unannotated function infers them.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const source = `export service Users { static readonly key = "witness/Users"; readonly value: number }
export effect function written(): number!never { return (try Users).value }
export effect function omitted() { return (try Users).value }
export effect function empty(): number!never! { return 1 }
export const UsersLive = Layer.succeed(Users, { value: 41 })
export effect function main() { provide UsersLive { return (try written()) + (try omitted()) + (try empty()) } }
`
const observe = `import { Effect } from "effect"
import { main } from "./out/main.js"
console.log(JSON.stringify(await Effect.runPromise(main())))
`
for (const scope of [["--fix"], ["--fix", "--fix-migration-only"]]) {
  project(({ put, read, invoke, run }) => {
    put("tsconfig.json", { compilerOptions: { ...baseOptions(), declaration: true }, include: ["main.vibe"] })
    put("main.vibe", source)
    put("observe.mjs", observe)
    const before = invoke("-p", ".", "--pretty", "false")
    // One warning, at the A!E annotation with the omitted slot; none for the
    // explicitly empty slot A!E! or for the unannotated function.
    const ek4853 = before.text.split("\n").filter(line => /EK4853/.test(line) && /^main/.test(line))
    assert.deepEqual(ek4853.map(line => line.replace(/:.*$/, "")), ["main.vibe(2,35)"], before.text)
    assert.ok(diagnostics(before.text).includes("warning EK4853"), before.text)
    assert.ok(!diagnostics(before.text).includes("error EK4853"), before.text)
    // The omitted slot now means never: the body's requirement is an error.
    assert.ok(diagnostics(before.text).includes("error EK9202"), before.text)
    // Omitting the whole annotation infers the contract, requirements included.
    assert.match(read("out/main.d.ts"), /function omitted\(\): Effect\.Effect<number, never, Users>;/)

  })
}
console.log("EK4853 warns and its repair writes the inferred requirements")
