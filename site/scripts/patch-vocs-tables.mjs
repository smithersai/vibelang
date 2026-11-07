import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { patchVocsModule } from './patch-vocs-module.mjs'

// The overflow container must accept focus for native arrow-key scrolling.
const spec = {
  "name": "mdx",
  "directory": "",
  "sourceRoot": "../src",
  "before": "<div data-v-table-wrapper>",
  "after": "<div data-v-table-wrapper tabIndex={0}>",
  "hashes": {
    "source": "a041d884f669657e4fdc97270170731f269203481faa949f4ae90dd3045e897f",
    "patched": "14135cb031873f69c80d14b82b54fa1669fb6b75c45a77418076f2baa40e96ff",
    "javascript": "342b91aef4f4e693a7d217293502a5e5f6d7d097d948e0dba66a932765cbc314",
    "map": "ec1990c40dc1f9afb06654ced5377b0d856078d7f1b5bfdf184998d2b27a8fc4"
  }
}
export function patchVocsTables(root = fileURLToPath(new URL('../', import.meta.url))) {
  return patchVocsModule(root, spec)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = patchVocsTables()
    console.log('Vocs ' + result.version + ' table keyboard patch ' + (result.changed ? 'applied.' : 'already applied.'))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
