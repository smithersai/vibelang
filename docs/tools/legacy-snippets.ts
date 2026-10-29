// Prepared by the oracle command, using exactly the snippet checker's extraction
// and page scope. The caller owns (and removes) the temporary directory.
import { readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { extract, linkModules, markdownPages, writeProject } from "./check-snippets"

export function legacyProjects(temp: string) {
  const repo = resolve(import.meta.dir, "../..")
  linkModules(temp)
  return markdownPages(join(repo, "docs/user")).flatMap((page, index) => {
    const blocks = extract(readFileSync(page, "utf8"), {
      inlineExamples: [join(repo, "docs/user/llms-essentials.md"), join(repo, "templates/app/AGENTS.md")].includes(page)
    })
    if (!blocks.length) return []
    const dir = join(temp, String(index))
    const { filenames, offsets } = writeProject(dir, blocks)
    return [{ config: join(dir, "tsconfig.json"), blocks: blocks.map(block => ({
      file: join(dir, filenames.get(block.number)!), page: relative(repo, page),
      number: block.number, line: block.line, offset: offsets.get(filenames.get(block.number)!)!,
      lines: block.source.split("\n").length, language: block.language, fragment: block.fragment
    })) }]
  })
}

if (import.meta.main) console.log(JSON.stringify(legacyProjects(resolve(process.argv[2]))))
