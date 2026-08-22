import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const generated = resolve(root, "dist");

if (dirname(generated) !== root || basename(generated) !== "dist") {
  throw new Error(`Refusing to clean unexpected path: ${generated}`);
}

await rm(generated, { recursive: true, force: true });
