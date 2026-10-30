import assert from 'node:assert/strict'
import test from 'node:test'
import {block,chapter,read,run} from './spec-witness.mjs'
test('ambient service rejection follows the whole native source context',()=>{
 const service=chapter('005-services'),catalog=chapter('900-appendices')
 assert.ok(service.includes('Inherited ambient context is a source property'))
 assert.ok(service.includes('Nested regions and `export` do not escape inherited ambientness'))
 for(const text of ['ambient external `declare module`','`declare global`','native declaration-file context'])assert.ok(service.includes(text),text)
 assert.ok(catalog.includes('a custom `service` declaration in a native ambient source context, explicit or inherited'))
 assert.ok(read('docs/design/vips/0009-service-declarations.md').includes('Determine the context from source semantics'))
 const result=run(block(service,'const ambientContextRepairExit')+'\nif(!Exit.isSuccess(ambientContextRepairExit)||ambientContextRepairExit.value!==7)throw new Error("changed runtime alternative")')
 assert.equal(result.status,0,result.stdout+result.stderr)
})
