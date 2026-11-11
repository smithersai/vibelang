import type { SqlClient } from "effect/sql"
import { plain } from "./helper.js"
const plained = plain()
export type Plained = typeof plained
export type Named = SqlClient.SqlClient
