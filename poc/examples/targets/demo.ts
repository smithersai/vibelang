import { analyzeCompatibility } from "../../src/targets/index.ts";

const report = analyzeCompatibility(`
  import type { User } from "./types";
  import { readFileSync } from "node:fs";
  function legacy(): any { return readFileSync("config.json") as any }
  function application() { return legacy() }
  /** @native */
  function pinnedNative() { return application() }
`);

console.log(JSON.stringify(report, null, 2));

