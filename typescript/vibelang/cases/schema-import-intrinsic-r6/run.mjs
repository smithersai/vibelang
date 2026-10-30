import { Schema } from "effect"
import { User, Code } from "./out/main.js"
import { Name } from "./out/namespace.js"
console.log(JSON.stringify([Schema.decodeUnknownSync(User)({name: "Ada", nested: {value: 1}, values: [2]}), Schema.decodeUnknownSync(Code)("a"), Schema.decodeUnknownSync(Name)("name")]))
