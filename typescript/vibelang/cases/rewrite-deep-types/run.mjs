// run-seconds: 180 (six compareRewrite stages, 30 s each)
import { compareRewrite } from "../../rewrite-preservation.mjs"
// VIP-3 / tooling chapter: array boundaries allow every level to shorten,
// while direct nesting must retain qualification to preserve grouping.
// Each adjacent pair can shorten its outer level without new parentheses;
// the next level remains qualified inside that shorthand success slot.
const grouped = "Effect.Effect<".repeat(10) + "number" + ">!!".repeat(10)
const arrays = "Array<".repeat(20) + "number" + ">!!".repeat(20)
await compareRewrite(import.meta.url, "ok\n", {
  present: ["export type Deep = " + arrays, "export type Grouped = " + grouped],
  absent: ["Effect.Effect<Array<"]
})
