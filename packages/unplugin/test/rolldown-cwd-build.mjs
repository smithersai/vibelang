import { rolldown } from "rolldown"
import vibelang from "../src/rolldown.js"

// Run in a separate process so tests never change the runner's working directory.
const requests = JSON.parse(process.argv[2])
const before = process.cwd()
const results = await Promise.all(requests.map(async ({ cwd, input, options }) => {
  let bundle
  try {
    bundle = await rolldown({
      ...(cwd === undefined ? {} : { cwd }), input,
      platform: "node", plugins: [vibelang(options)],
      onLog(level, log, handler) { if (level === "error") handler(level, log) }
    })
    const result = await bundle.generate({ format: "es", sourcemap: true })
    const chunk = result.output.find(item => item.type === "chunk" && item.isEntry)
    const module = await import("data:text/javascript;base64," + Buffer.from(chunk.code).toString("base64"))
    return { ok: true, answer: module.answer, modules: Object.keys(chunk.modules), map: chunk.map }
  } catch (error) {
    return { ok: false, message: error.message }
  } finally {
    await bundle?.close()
  }
}))
console.log(JSON.stringify({ cwdUnchanged: before === process.cwd(), results }))
