import { make } from "./lib.js"

export const node = make(1)
export const nodes = [make("a"), make(true)] as const
