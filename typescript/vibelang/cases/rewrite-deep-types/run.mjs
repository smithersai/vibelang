// run-seconds: 180 (six compareRewrite stages, 30 s each)
import { compareRewrite } from "../../rewrite-preservation.mjs"
// VIP-3 requires parentheses at each nested shorthand success slot.
// The declaration API and runtime behavior remain unchanged.
const grouped = "(".repeat(19) + "number!!" + ")!!".repeat(19)
const arrays = "Array<".repeat(20) + "number" + ">!!".repeat(20)
await compareRewrite(import.meta.url, "ok\n", {
  present: ["export type Deep = " + arrays, "export type Grouped = " + grouped],
  absent: ["Effect.Effect<Array<"]
})
