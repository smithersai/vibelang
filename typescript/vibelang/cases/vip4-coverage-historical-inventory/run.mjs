// rule-evidence: docs/design/vips/0004-throw.md#b776ab2b39524a0c
// VIP-4: VibeLang ships the rethrowing globals: map, forEach, filter, reduce, find,
// rule-evidence: docs/design/vips/0004-throw.md#f31885994e1f643c
// VIP-4: … Any javascript globals like JSON.parse must have no annotation.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const {entries} = JSON.parse(readFileSync(new URL("../../../../docs/design/inventory/throws.json",import.meta.url),"utf8"))
const find = (module,name) => entries.filter(e=>e.module===module && e.declaration===name)
const problems=[]
if (!find("global","Promise").some(e=>e.rethrows.includes("executor"))) problems.push("old Promise executor rethrows claim conflicts with the accepted rejection correction")
const ts = (await import(new URL("../../../../docs/tools/node_modules/typescript/lib/typescript.js",import.meta.url))).default
const lib = ts.createSourceFile("lib.es5.d.ts",readFileSync(new URL("../../../../docs/tools/node_modules/typescript/lib/lib.es5.d.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true)
const json = lib.statements.find(n=>ts.isInterfaceDeclaration(n)&&n.name.text==="JSON")
const parse = json.members.filter(n=>n.name?.getText(lib)==="parse")
if (parse.some(n=>ts.getJSDocTags(n).some(tag=>tag.tagName.text==="throws"))) problems.push("original no-global-annotations quotation needs reconciliation with the pinned annotated JSON.parse signature")
assert.deepEqual(problems,[])
console.log("historical annotation inventory claims")
