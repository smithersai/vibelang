// run-seconds: 180 (six compareRewrite stages, 30 s each)
import { compareRewrite } from "../../rewrite-preservation.mjs"
await compareRewrite(import.meta.url, '["undefined","undefined","undefined","undefined","undefined","undefined"]\n["undefined","1","undefined"]\n', {
  present: ['when { _tag: "NF" }: (undefined as void);', "when true: ((void 0) as void);", "default: (void 0);", "export const held = Effect.void", "try programSource().void", "try Effect /* retain operand */ .void"],
  absent: ["try Effect.void", "try Effect.undefined"]
})
