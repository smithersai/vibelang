import { readFileSync } from "node:fs";
import { hello, twice, greeting } from "./out/index.js";
// The emitted JavaScript names target.js, which target.vibe emits; the migrated source import declares the runtime name ./target.js.
const consumer = readFileSync(new URL("./out/consumer.d.ts", import.meta.url), "utf8");
console.log(JSON.stringify([hello(), twice(greeting), consumer.includes("'./target.js'"), consumer.includes(".vibe")]));
