import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bind } from "./out/Bind.js";
const declaration = readFileSync(new URL("./out/Bind.d.ts", import.meta.url), "utf8");
// VIP-30 retires style selection; the retired-option case compares all values
// against unconfigured declarations. Keep this fixture's runtime/API check.
assert.doesNotMatch(declaration, /\.vibe["']/);
console.log(JSON.stringify(bind({ n: 1 }).reason));
