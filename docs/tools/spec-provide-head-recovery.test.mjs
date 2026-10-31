import assert from 'node:assert/strict'
import test from 'node:test'
import {block,chapter,read,run} from './spec-witness.mjs'
test('provider-comma recovery is bounded to both sides of actual list separators',()=>{
 const source=chapter('005-services'),grammar=chapter('900-appendices')
 assert.ok(source.includes('only a line break immediately before or after'))
 assert.ok(source.includes('Relax only those comma-adjacent restrictions'))
 assert.ok(source.includes('Invalid recovered heads have no lowering or runtime counterpart'))
 assert.ok(grammar.includes('`EK1202` on either side'))
 assert.ok(read('docs/design/vips/0012-provide.md').includes('bounded provider-comma recovery'))
 const result=run(block(source,'const providerRecoveryExit')+'\nif(providerRecoveryExit._tag!=="Success"||JSON.stringify(providerRecoveryExit.value)!=="[7,7,2,[2,3],9,8]")throw new Error("changed native readings")')
 assert.equal(result.status,0,result.stdout+result.stderr)
})
