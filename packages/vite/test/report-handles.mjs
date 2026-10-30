// run.sh imports this into every test file. node --test --test-force-exit
// ends a file once its tests are done, even if a handle still holds the
// event loop: one did after every test passed, and the merge gate waited
// 860 s for vite-test (mq-10301555-49). This names the handles a file's
// tests left open, beyond those open before they ran, so the leak can be
// found and closed.
import { basename } from "node:path"
import { after } from "node:test"
import { setImmediate } from "node:timers/promises"

// Standard streams are lazy. Vite can initialize stdin and console can
// initialize stdout after this module loads; neither is a test-owned pipe.
void process.stdin
void process.stdout
void process.stderr

const count = (names) => names.reduce((counts, name) => counts.set(name, (counts.get(name) ?? 0) + 1), new Map())
const before = count(process.getActiveResourcesInfo())

after(async () => {
  // Close callbacks resolve promises before libuv releases their resources.
  await setImmediate()
  await setImmediate()
  const left = []
  for (const [name, n] of count(process.getActiveResourcesInfo())) {
    for (let i = before.get(name) ?? 0; i < n; i++) left.push(name)
  }
  if (left.length > 0) console.error(`${basename(process.argv[1] ?? "a test file")} left handles open after its tests: ${left.join(", ")}`)
})
