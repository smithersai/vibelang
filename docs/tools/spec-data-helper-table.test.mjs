import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { lexer } from 'marked'
test('reserved data helper names render inside the static-rule table', () => {
 const chapter=readFileSync(new URL('../design/src/006-data.md',import.meta.url),'utf8')
 const start=chapter.indexOf('## `data` declarations')
 const end=chapter.indexOf('### Generic unions',start)
 assert.ok(start>=0&&end>start)
 const tables=lexer(chapter.slice(start,end)).filter(t=>t.type==='table')
 const rules=tables.find(t=>t.header.map(c=>c.text).join('|')==='Rule|Diagnostic')
 assert.ok(rules,'data static-rule table is missing')
 assert.ok(rules.rows.some(row=>row.some(cell=>cell.text==='`EK1602`')),'EK1602 must be a rendered table row')
})
