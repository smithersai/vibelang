import { compareChapter007Twin } from "../../test/chapter007-twin.mjs"
await compareChapter007Twin(new URL(".", import.meta.url), {"made": 1, "reads": 3, "constructor": true, "first": "A", "second": "A", "lateFirst": "B", "lateSecond": "C", "loaded": 1})
console.log("ok")
