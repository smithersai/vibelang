import assert from "node:assert/strict"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cache, ready } from "./reference.mjs"

assert.ok(ready(cache), "prepare the framework reference with bun run --cwd docs/tools prepare:frameworks")
export const { babel, solid, reactTransform, createElement, createComponent, ts } = await import(pathToFileURL(path.join(cache, "modules.mjs")).href)
