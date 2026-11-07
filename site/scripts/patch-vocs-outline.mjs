import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { patchVocsModule } from './patch-vocs-module.mjs'

// The decorative position indicator is a presentational list item.
const spec = {
  "name": "Outline",
  "before": "      <div\n        className=\"vocs:absolute vocs:left-[-2px]",
  "after": "      <li\n        role=\"presentation\"\n        aria-hidden=\"true\"\n        className=\"vocs:absolute vocs:left-[-2px]",
  "hashes": {
    "source": "c2a2b76d9ee30e8b94f199d7f6c23511dad79b0cd81775eeccbf6ca2b5b00682",
    "patched": "f3e3371d2954f4f2254cf63df2f33de033e4cfbd9f99bec693f7d5909c5aa1ec",
    "javascript": "42b1e31f0d8145373c49a8d45f5db8aa87d0b1272e9bab281b2376837240a0de",
    "map": "a6c1ce9d83927afb3d87f3ad23b0e3c44617c8272cdc9dcc62ba58531d145a0f"
  }
}
export function patchVocsOutline(root = fileURLToPath(new URL('../', import.meta.url))) {
  return patchVocsModule(root, spec)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = patchVocsOutline()
    console.log('Vocs ' + result.version + ' outline list patch ' + (result.changed ? 'applied.' : 'already applied.'))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
