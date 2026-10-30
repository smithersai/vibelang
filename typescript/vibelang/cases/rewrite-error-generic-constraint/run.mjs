import { compareRewrite } from "../../rewrite-preservation.mjs"
await compareRewrite(import.meta.url, "ok\n", { mode: "fix", present: ['class Bad<T extends string>'], absent: ["error Bad<"] })
