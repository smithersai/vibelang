import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const repo = fileURLToPath(new URL("../../../", import.meta.url))
export const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
export const fc = require("fast-check")
export const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
export const skip = [native, effect, join(runtime, "dist/index.js")].some(p => !existsSync(p)) && "build compiler and runtime first"

