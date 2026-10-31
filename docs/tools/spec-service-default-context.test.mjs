import assert from 'node:assert/strict'
import test from 'node:test'
import {block,chapter,read,run} from './spec-witness.mjs'
test('service default initializers keep source class-field permission and eager cold timing',()=>{
 const source=chapter('005-services')
 assert.ok(source.includes('defaultValue` initializer has the source class-field context'))
 assert.ok(source.includes('`try e` there is `EK0501`'))
 assert.ok(source.includes('existing eager throw checks'))
 assert.ok(chapter('002-running').includes('emitted options-object position does not grant source Effect execution'))
 assert.ok(chapter('900-appendices').includes('A `DefaultMember` initializer uses the source class-field context'))
 for(const name of ['0009-service-declarations','0017-fork'])assert.ok(read('docs/design/vips/'+name+'.md').includes('service default initializer context'))
 const result=run(block(source,'const defaultInitializerExit')+'\nif(JSON.stringify(beforeDefaultRun)!=="[0,0]"||defaultInitializerExit._tag!=="Success"||JSON.stringify(defaultInitializerExit.value)!=="[1,1,1]")throw new Error("changed initializer/fallback timing")')
 assert.equal(result.status,0,result.stdout+result.stderr)
})
