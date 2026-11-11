import { Option } from "effect"
import { readFileSync } from "node:fs"
import * as m from "./out/main.js"

console.log("first:", Option.getOrNull(m.first), "length:", m.length, "keys:", m.keys.join(","), "some:", m.some)
console.log("LanguageModel.generateText:", typeof m.model.generateText, "TestClock.adjust:", typeof m.clock.adjust)
for (const line of readFileSync("out/main.js", "utf8").split("\n")) if (line.startsWith("import ")) console.log(line)
