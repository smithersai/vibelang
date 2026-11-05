import { readFileSync } from "node:fs";
import { hello, twice, greeting } from "./out/index.js";
// VIP-27 maps VibeLang source extensions to the native twin in package declarations; JavaScript keeps its runtime route.
const consumer = readFileSync(new URL("./out/consumer.d.ts", import.meta.url), "utf8");
console.log(JSON.stringify([hello(), twice(greeting), /['"]\.\/target\.ts['"]/.test(consumer), consumer.includes(".vibe")]));
