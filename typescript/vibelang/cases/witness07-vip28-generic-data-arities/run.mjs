import {checkTwin} from "../../test/coverage-twin.mjs"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
checkTwin(fileURLToPath(new URL(".",import.meta.url)))
const declarations=readFileSync(new URL("out/main.d.ts",import.meta.url),"utf8")
for(const [name,arity] of [["One",1],["Two",2],["Three",3],["Four",4]])
 assert.match(declarations,new RegExp("interface \\$"+name+"\\$Definition extends[^\\n]*WithGenerics<"+arity+">"),name)
console.log("arities one through four match WithGenerics twins")
