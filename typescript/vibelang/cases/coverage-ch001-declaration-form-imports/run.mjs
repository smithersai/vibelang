// run-seconds: 300
import {Effect} from "effect"
import {checkDeclarationPrelude} from "../../tests/coverage-declaration-prelude.mjs"
await checkDeclarationPrelude(import.meta.url,true,Effect)
console.log("coverage-ok")
