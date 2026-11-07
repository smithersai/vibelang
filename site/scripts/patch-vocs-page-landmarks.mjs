import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { patchVocsModules } from './patch-vocs-module.mjs'

const specs = [
  {
    "name": "Layout.client",
    "directory": "react",
    "sourceRoot": "../../src/react",
    "edits": [
      {
        "before": "          data-v-gutter-logo\n",
        "after": "          role=\"navigation\"\n          aria-label=\"Home\"\n          data-v-gutter-logo\n"
      },
      {
        "before": "          data-v-gutter-top\n",
        "after": "          role=\"banner\"\n          aria-label=\"Site header\"\n          data-v-gutter-top\n"
      }
    ],
    "hashes": {
      "source": "e658d95e37059987243de1f5310527883687c75039f08c5a8c18a7c6c11fcb43",
      "patched": "b99da96737fb28e29d42db1c10ca65d6d44e1e1044f82af0f17f726805e724a8",
      "javascript": "7ee670ce1ab0f902ea35b7fe86fa09a4470b49e8d6f10b470446f38feef8e530",
      "map": "eb9ad08ba9e5bfb7cf71cc35abeeaafd15dab7e337990398a82e39478dd64eb7"
    }
  },
  {
    "name": "Banner.client",
    "directory": "react/internal",
    "sourceRoot": "../../../src/react/internal",
    "edits": [
      {
        "before": "      data-v-banner\n",
        "after": "      role=\"complementary\"\n      aria-label=\"Release status\"\n      data-v-banner\n"
      }
    ],
    "hashes": {
      "source": "b665d0b713d668d32c284a1f570eb9b02027991785de29c46b097be990344051",
      "patched": "0123dd90de470a23b13cc113eadd87258f5eb200c21579b998b22d7f1357d899",
      "javascript": "291f078891518975eba85808c89467c3e876bdecbd5b2a7b473f0384c7cb9d04",
      "map": "3dcf73e2e855caa57e3480b71e2c3d31aedc7db005d231c64d32fbc1515a78cd"
    }
  }
]
export function patchVocsPageLandmarks(root = fileURLToPath(new URL('../', import.meta.url))) {
  return patchVocsModules(root, specs)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = patchVocsPageLandmarks()
    console.log('Vocs ' + result.version + ' page landmarks ' + (result.changed ? 'applied.' : 'already applied.'))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
