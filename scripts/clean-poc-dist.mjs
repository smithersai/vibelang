import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pocRoot = resolve(root, "poc");
const generated = resolve(pocRoot, "dist");

if (dirname(generated) !== pocRoot || basename(generated) !== "dist") {
  throw new Error(`Refusing to clean unexpected path: ${generated}`);
}

await rm(generated, { recursive: true, force: true });
