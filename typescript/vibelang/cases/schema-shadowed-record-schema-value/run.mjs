import { Schema } from "effect"
import { S } from "./out/main.js"
console.log([Schema.decodeUnknownExit(S)({ a: { k: "ok" } })._tag, Schema.decodeUnknownExit(S)({ a: { k: 1 } })._tag].join(" "))
