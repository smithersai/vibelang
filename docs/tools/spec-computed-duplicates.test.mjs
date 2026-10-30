import assert from 'node:assert/strict'
import test from 'node:test'
import {block,chapter,read,run} from './spec-witness.mjs'
test('computed data payload duplicates retain native TypeScript merging and compatibility checks',()=>{
 const source=chapter('006-data')
 assert.ok(!source.includes('Duplicate variant or field names get TypeScript’s duplicate-identifier diagnostic'))
 assert.ok(source.includes('Computed members with the same resolved name can merge'))
 assert.ok(read('docs/design/vips/0016-data-declarations.md').includes('Duplicate members retain native TypeScript checking and merging'))
 const result=run(block(source,'const duplicateKeyExit')+'\nif(duplicateKeyExit._tag!=="Success"||duplicateKeyExit.value!==7)throw new Error("wrong merged payload value")')
 assert.equal(result.status,0,result.stdout+result.stderr)
})
