import { returned, jumps, vars, suspended, yielded } from "./out/main.js"
const it = yielded()
console.log(JSON.stringify([returned(), jumps(), vars(), await suspended(), it.next().value, it.next().value]))
