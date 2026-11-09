import {readFileSync} from "node:fs";
const declaration=readFileSync(new URL("./out/main.d.ts",import.meta.url),"utf8");
if(!declaration.includes("vibelang-runtime"))throw new Error("missing runtime type provider");
const {main}=await import("./out/main.js");console.log(JSON.stringify(main()));
