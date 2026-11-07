// run-seconds: 120
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Use a listed service layer only when the pinned legacy compiler selected it; preserve selected experimental layers and nesting order.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Refuse an unavailable runner or layer, an entry test not expressible in admitted source, or any other loss of types, behavior or declarations: keep the marker and report its file, line and reason as not fixed, with a nonzero exit.
// The marked sources in inputs/ once started main through the retired entry
// dispatcher. Each now keeps its marker under vibelang --fix, whose refusal
// names the runner and layers the legacy compiler selected; this case checks
// that selection, writes the advice into the modules the host starts, as the
// program's owner would, and runs them as before.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { migrated } from "../../tests/entry-migration.mjs"
const m = migrated(import.meta.url, ["none.vibe", "crypto.vibe"])
assert.notEqual(m.fix.status, 0, `a refused startup fails --fix\n${m.fix.output}`)
assert.deepEqual(m.runners(), {
  "app.vibe": "BrowserRuntime.runMain(Effect.provide(main(), ExperimentalBrowserServices.layer))",
  "crypto.vibe": "BrowserRuntime.runMain(Effect.provide(main(), ExperimentalBrowserServices.layer))",
  "none.vibe": "BrowserRuntime.runMain(main())"
}, m.fix.output)
for (const found of Object.values(m.advice)) assert.doesNotMatch(found.line, /NodeRuntime|platform-node/, `a browser marker names no Node runner: ${found.line}`)
assert.equal(m.build.status, 0, `the advised source compiles cleanly\n${m.build.output}`)
// app.vibe is imported by page.vibe, which starts its main: app.vibe only loses its marker.
process.chdir(m.dir)
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
