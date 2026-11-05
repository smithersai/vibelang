import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const { vibePath } = await import(pathToFileURL(resolve(".smithers/flows/migrate/lib/codemod.mjs")).href)
const { file } = JSON.parse(readFileSync(0, "utf8"))
try {
  console.log(JSON.stringify({ rejected: false, value: vibePath(file) }))
} catch (error) {
  if (!/only a \.ts or \.mts module becomes \.vibe/.test(error.message)) throw error
  console.log(JSON.stringify({ rejected: true, error: error.message }))
}
