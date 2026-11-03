// run-seconds: 180 (six compareRewrite stages, 30 s each)
import { compareRewrite } from "../../rewrite-preservation.mjs"
await compareRewrite(import.meta.url, "[0,1,1,[2,3]]\n", {
  present: ["const held = retry(", "try forEach("],
  absent: ["Effect.retry(", "Effect.forEach("]
})
