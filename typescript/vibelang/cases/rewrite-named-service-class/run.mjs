// run-seconds: 180 (six rewrite-preservation stages)
import { compareRewrite } from "../../rewrite-preservation.mjs"
await compareRewrite(import.meta.url, '["BetterAuth.Database",7]\n', {
  present: ["service QueryPort: typeof queryShape", "service Database: DatabaseService", 'static readonly key = "BetterAuth.Database"', "/* retain the class body */"],
  absent: ["class Database extends", "class QueryPort extends"]
})
