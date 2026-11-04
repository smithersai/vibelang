import { readFileSync } from "node:fs";
import { label } from "./out/index.js";
// The augmentation keeps the TypeScript twin's .ts spelling, which resolves to User.d.ts; no .vibe source ships beside it.
const declaration = readFileSync(new URL("./out/index.d.ts", import.meta.url), "utf8");
console.log(JSON.stringify([label, declaration.includes(".vibe"), declaration.includes('declare module "./User.ts"')]));
