import { get, tagged, overloaded, defaultReject, generator } from "./out/main.js"
console.log(await get("ok"), await tagged("tagged"), await overloaded("overload"))
console.log(await get("").catch(e => e.message))
let synchronous = false
try { generator() } catch (error) { synchronous = error.message === "default" }
console.log(synchronous, await defaultReject().catch(error => error.message))
