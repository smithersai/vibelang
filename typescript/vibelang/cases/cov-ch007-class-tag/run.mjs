import { compareChapter007Twin } from "../../test/chapter007-twin.mjs"
await compareChapter007Twin(new URL(".",import.meta.url),{tagged:["handled","handled","propagated"],instance:["handled","propagated","propagated"],structuralIsError:true})
console.log("ok")
