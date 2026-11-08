import { Schema } from "effect"
import { Value } from "./out/main.js"
console.log(JSON.stringify([Schema.is(Value)(new Date(0)), Schema.is(Value)("1970")]))
