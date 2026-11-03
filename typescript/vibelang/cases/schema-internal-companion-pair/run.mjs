import { stripInternalOutput } from "../_schema-stripinternal.mjs"
stripInternalOutput(["Message", "Code", "Nested"])
console.log("native stripInternal output and dangling aliases match TypeScript")
