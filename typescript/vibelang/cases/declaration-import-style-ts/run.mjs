import { readFileSync } from "node:fs";
import { bind } from "./out/Bind.js";
const declaration = readFileSync(new URL("./out/Bind.d.ts", import.meta.url), "utf8");
console.log(JSON.stringify([bind({ n: 1 }).reason, declaration.includes(".js"), declaration.includes(".vibe")]));
