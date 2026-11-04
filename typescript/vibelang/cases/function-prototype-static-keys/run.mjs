import { checks } from "./out/main.js"
if (checks.some(x=>!x)) throw new Error(JSON.stringify(checks))
console.log(JSON.stringify(checks))
