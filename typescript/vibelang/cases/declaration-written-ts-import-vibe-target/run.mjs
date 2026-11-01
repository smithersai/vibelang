import { readFileSync } from "node:fs";
import { hello, twice, greeting } from "./out/index.js";
// The emitted JavaScript names target.js, which target.vibe emits; the declarations keep ./target.ts as written.
const consumer = readFileSync(new URL("./out/consumer.d.ts", import.meta.url), "utf8");
console.log(JSON.stringify([hello(), twice(greeting), consumer.includes("'./target.ts'"), consumer.includes(".js")]));
