import { Schema } from "effect"
import { S } from "./out/main.js"
console.log([Schema.decodeUnknownExit(S)({ a: { x: 1 } })._tag, Schema.decodeUnknownExit(S)({ a: { x: "1" } })._tag].join(" "))
