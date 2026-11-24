import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fence, readFences } from './docs-markdown.mjs'
import { loadVips, proposalMarkdownLinks } from './vip-docs.mjs'

export function addProposalMarkdown(output, docs, source) {
  const proposals = readFileSync(source, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '')
  const body = readFences(proposals.split('\n')).map(part =>
    part.type === 'code' ? fence(part) : proposalMarkdownLinks(part.line)).join('\n')
  const pages = [{ path: 'proposals.md', title: 'Proposals', body }, ...loadVips(docs).markdown()]
  for (const page of pages) {
    const file = join(output, page.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, page.body)
  }
  const index = join(output, 'llms.txt')
  const links = pages.map(page => `- [${page.title}](https://vibelang.sh/${page.path})`)
  writeFileSync(index, readFileSync(index, 'utf8').trimEnd() + '\n\n## Improvement proposals\n\n' + links.join('\n') + '\n')
}
