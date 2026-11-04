import { checks } from "./out/main.js"
if (checks.length !== 6 || checks.some(x => x !== true)) throw new Error(JSON.stringify(checks))
console.log(JSON.stringify(checks))
