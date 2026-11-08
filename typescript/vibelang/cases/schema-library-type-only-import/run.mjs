import { Schema } from "effect"
import { Example, Single, FromNamespace, BeforeValue } from "./out/main.js"
const value = {at:new Date(0),site:new URL("https://example.com"),pattern:/a/,bytes:new Uint8Array([1]),cause:new Error("bad")}
console.log(JSON.stringify([Schema.is(Example)(value),Schema.is(Example)({...value,at:"date"}),Schema.is(Single)(new Date(0)),Schema.is(FromNamespace)(new Date(0)),Schema.is(BeforeValue)(new Date(0))]))
