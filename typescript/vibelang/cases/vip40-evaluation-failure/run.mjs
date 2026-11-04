const { log } = await import("./out/log.js")
try {
  await import("./out/main.js")
  console.log("loaded")
} catch (error) {
  console.log(`rejected ${error.constructor.name}: ${error.message}`)
}
console.log(JSON.stringify(log))
