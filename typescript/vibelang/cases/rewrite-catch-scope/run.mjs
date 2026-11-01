// run-seconds: 180 (six compareRewrite stages, 30 s each)
import { compareRewrite } from "../../rewrite-preservation.mjs"
await compareRewrite(import.meta.url, "1 100\n11 100\n", {})
