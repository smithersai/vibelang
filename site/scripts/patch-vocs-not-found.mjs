import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { patchVocsModule } from './patch-vocs-module.mjs'

// Missing pages expose the same main landmark as content pages.
const spec = {
  "name": "NotFound",
  "before": "    <div\n      className=",
  "after": "    <div\n      role=\"main\"\n      className=",
  "hashes": {
    "source": "7f062bdb49e4179c3f08f99c02464cabc08e3b05ddb6dfb0716eb78185d1de32",
    "patched": "910cecc77ad59bb624ebf05dec23169d00d723db0e4567e71eff3c9dfb420e19",
    "javascript": "326f662c59df65f069f3e37c1fa2adf4fb9a4079b2b8b7580e903a664842b4be",
    "map": "11b55d9dd05bd7159a0b3ec1fec1afafe5d3e5ed59fa20d1b7799863f17dc640"
  }
}
export function patchVocsNotFound(root = fileURLToPath(new URL('../', import.meta.url))) {
  return patchVocsModule(root, spec)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = patchVocsNotFound()
    console.log('Vocs ' + result.version + ' missing-page landmark patch ' + (result.changed ? 'applied.' : 'already applied.'))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
