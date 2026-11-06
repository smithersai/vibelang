import { Effect } from "effect"
import { doubled } from "./source.js"

export const fromTypeScript: Effect.Effect<number> = doubled(4)
