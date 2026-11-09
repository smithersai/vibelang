import { readFileSync } from "node:fs"
const declarations=readFileSync(new URL("./out/main.d.ts",import.meta.url),"utf8")
if(!declarations.includes('"vibelang-runtime"')&&!declarations.includes("'vibelang-runtime'"))throw new Error("Published matcher key lacks its runtime type dependency")
const { main }=await import("./out/main.js")
console.log(JSON.stringify(main()))
