import { compareChapter007Twin } from "../../test/chapter007-twin.mjs"
await compareChapter007Twin(new URL(".", import.meta.url), {"atCall":1,"afterRun":1,"value":7,"ordinary":7})
console.log("ok")
