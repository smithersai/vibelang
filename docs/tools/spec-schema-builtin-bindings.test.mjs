import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { chapter, read, tools } from "./spec-witness.mjs"
import { join } from "node:path"

test("schema generic mappings require type bindings and preserve value-only shadowing", () => {
  const data = chapter("006-data")
  assert.ok(data.includes("selected by ordinary type lookup and alias resolution, not by spelling"))
  assert.ok(data.includes("a value-only binding does not by itself replace the separate library type binding"))
  assert.ok(data.includes("This does not expand arbitrary user type aliases or introduce generic Schema declarations."))
  assert.ok(read("docs/design/vips/0015-schema-declarations.md").includes("mapped generic bindings"))
  assert.ok(chapter("900-appendices").includes("including a shadowing type without a suitable Schema value"))
})

test("native type lookup separates library generic symbols from local type and value names", { timeout: 60000 }, () => {
  const sources = new Map(), witnesses = []
  for (const [name, params, args] of [
    ["Array", "T", "number"], ["ReadonlyArray", "T", "number"],
    ["Record", "K,V", "string,number"], ["Readonly", "T", "{x:number}"]
  ]) for (const kind of ["library", "value", "alias", "interface", "class"]) {
    const binding = {
      library: "", value: "const " + name + " = 1;",
      alias: "type " + name + "<" + params + "> = {own:number};",
      interface: "interface " + name + "<" + params + "> {own:number}",
      class: "class " + name + "<" + params + "> {own = 1}"
    }[kind]
    const file = join(tools, "__schema_binding_" + name + "_" + kind + ".ts")
    sources.set(file, "export {}; " + binding + " type Selected = " + name + "<" + args + ">;")
    witnesses.push({file, library: kind === "library" || kind === "value"})
  }
  const options = {target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.NodeNext,
    moduleResolution:ts.ModuleResolutionKind.NodeNext, strict:true, skipLibCheck:true, types:[]}
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, ...args) => sources.has(file)
    ? ts.createSourceFile(file, sources.get(file), options.target, true) : original(file, ...args)
  const program = ts.createProgram([...sources.keys()], options, host)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code), [])
  const checker = program.getTypeChecker()
  for (const {file, library} of witnesses) {
    const node = program.getSourceFile(file).statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === "Selected")
    const selected = checker.getSymbolAtLocation(node.type.typeName)
    assert.ok(selected, file)
    assert.equal(selected.declarations.some(d=>program.isSourceFileDefaultLibrary(d.getSourceFile())), library, file)
  }
})
