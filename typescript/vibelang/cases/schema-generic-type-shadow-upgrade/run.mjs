import { Schema } from "effect"
import { Numbers, Counts, numbers, counts } from "./out/main.js"
console.log(JSON.stringify([numbers, counts, Schema.is(Numbers)([1, 2]), Schema.is(Numbers)({ value: 1 }), Schema.is(Counts)({ apples: 3 }), Schema.is(Counts)({ apples: "bad" })]))
