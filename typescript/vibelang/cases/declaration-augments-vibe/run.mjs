import { readFileSync } from "node:fs";
import { label } from "./out/index.js";
// The augmentation names the emitted module, which a consumer resolves; no .vibe file ships beside it.
const declaration = readFileSync(new URL("./out/index.d.ts", import.meta.url), "utf8");
console.log(JSON.stringify([label, declaration.includes(".vibe"), declaration.includes('declare module "./User.js"')]));
