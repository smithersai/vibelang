import { results } from "./out/main.js"
if (JSON.stringify(results) !== "[1,2,1,2,1]") throw new Error("compatible overload results changed")
console.log("ok")
