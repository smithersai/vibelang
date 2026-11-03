// Repair only stale relative native-source imports; no renames or VIP rewrites.
import ts from "../docs/tools/node_modules/typescript/lib/typescript.js"
import { execFileSync } from "node:child_process"
import { migrateStaleSpecifiers } from "../.smithers/flows/migrate/lib/stale-specifiers.mjs"
const root = process.cwd()
const files = execFileSync("jj", ["file", "list"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim().split("\n")
const edits = migrateStaleSpecifiers(ts, root, files, {write: !process.argv.includes("--check")})
for (const edit of edits) console.log(JSON.stringify(edit))
console.log("Stale specifiers: " + edits.length)
if (process.argv.includes("--check") && edits.length) process.exitCode = 1
