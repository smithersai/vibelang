import vibelang from "../src/bun.js"

const { entrypoints, options } = JSON.parse(process.argv[2])
const before = process.cwd()
try {
  const result = await Bun.build({ entrypoints, target: "bun", plugins: [vibelang(options)] })
  if (!result.success) throw new Error(result.logs.map(String).join("\n"))
  const code = await result.outputs[0].text()
  const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
  console.log(JSON.stringify({ ok: true, answer: module.answer, cwdUnchanged: process.cwd() === before }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: String(error), errors: error.errors?.map(String) }))
  process.exitCode = 1
}
