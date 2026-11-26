// A reviewer command for the tests: it reads the prompt on standard input the
// way a coding agent's non-interactive mode does, and answers with the verdict
// and grade its arguments name, on the revision the prompt names.
//
//   node reviewer.mjs <verdict> <grade>     answer
//   node reviewer.mjs --fail <message>      print the message to standard error and exit 3
//   node reviewer.mjs --refuse <message>    print the message to standard output and exit 1
//   node reviewer.mjs --hang <file>         write the file, then wait to be stopped
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const [first, second] = process.argv.slice(2)
if (first === "--fail") {
  console.error(second)
  process.exit(3)
}
if (first === "--refuse") {
  console.log(second)
  process.exit(1)
}
if (first === "--hang") {
  writeFileSync(second, "started")
  setInterval(() => {}, 1000)
} else {
  const prompt = readFileSync(0, "utf8")
  const revision = /^REVISION: ([0-9a-f]{40})$/m.exec(prompt)[1]
  console.log(`VERDICT: ${first}\nGRADE: ${second}\nREVISION: ${revision}\n\nRead the chapters here: ${existsSync("docs/design/src/001-intro.md")}.`)
}
