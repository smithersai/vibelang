import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

export async function waitForLifecycleReceipt(file, { timeoutMs = 15000, pollMs = 10, read = readFile } = {}) {
  const end = Date.now() + timeoutMs
  let attempts = 0, chars = 0, state = "unread"
  while (Date.now() < end) {
    attempts++
    try {
      const text = await read(file, "utf8")
      chars = text.length
      return JSON.parse(text)
    } catch (error) {
      if (error.code === "ENOENT") state = "ENOENT"
      else if (error instanceof SyntaxError) state = "SyntaxError"
      else throw error
    }
    await delay(pollMs)
  }
  throw new Error("compiler lifecycle receipt timeout: file=" + basename(file) +
    " attempts=" + attempts + " chars=" + chars + " state=" + state)
}
