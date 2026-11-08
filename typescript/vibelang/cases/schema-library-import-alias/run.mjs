import * as Schema from "effect/Schema"
import { Example, Single } from "./out/main.js"
const value = {
 at: new Date(0), site: new URL("https://example.com"), pattern: /a/,
 bytes: new Uint8Array([1]), cause: new Error("bad"),
 renamedSite: new URL("https://example.com"), renamedDate: new Date(0),
}
console.log(JSON.stringify([Schema.is(Example)(value),Schema.is(Example)({...value,renamedSite:new Date(0)}),Schema.is(Single)(new Date(0)),Schema.is(Single)("date")]))
