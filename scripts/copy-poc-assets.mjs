import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildNativeCompiler } from "./build-native-compiler.mjs";
import { pocRuntimeAssets } from "./poc-runtime-assets.mjs";

const root = resolve(import.meta.dirname, "..");
for (const [source, destination] of pocRuntimeAssets) {
  const output = resolve(root, destination);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(root, source), output);
}

buildNativeCompiler();
