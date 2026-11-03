import { compareChapter007Twin } from "../../test/chapter007-twin.mjs"
await compareChapter007Twin(new URL(".", import.meta.url), {"cached":true,"fresh":false})
console.log("ok")
