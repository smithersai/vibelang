// run-seconds: 120
// Runs none.js as a host that says it started the module (Bun), then the
// page in Chromium when Playwright's Chromium is installed, else in Bun.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createServer } from "node:http"

process.stdout.write(execFileSync("bun", ["out/none.js"], { encoding: "utf8" }))

const chromium = await import("playwright").then((playwright) => playwright.chromium, () => undefined)
if (chromium === undefined || !existsSync(chromium.executablePath())) {
  console.error("Chromium is not installed (bunx playwright install chromium in packages/runtime): running the page in Bun.")
  process.stdout.write(execFileSync("bun", ["out/page.js"], { encoding: "utf8" }))
} else {
  execFileSync("bun", ["build", "out/page.js", "--target=browser", "--outfile=out/bundle/page.js"], { stdio: "ignore" })
  const script = readFileSync("out/bundle/page.js", "utf8")
  const server = createServer((request, response) => {
    if (request.url === "/page.js") response.writeHead(200, { "content-type": "text/javascript" }).end(script)
    else response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><script type=\"module\" src=\"/page.js\"></script>")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const logged = new Promise((resolve) => page.on("console", (message) => message.text().startsWith("page main ran") && resolve(message.text())))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    console.log(await logged)
  } finally {
    await browser.close()
    server.close()
  }
}
