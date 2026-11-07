import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { patchVocsModules } from './patch-vocs-module.mjs'

const specs = [
  {
    "name": "TopNav",
    "edits": [
      {
        "before": "<NavigationMenu.Root className=",
        "after": "<NavigationMenu.Root aria-label=\"Primary navigation\" className="
      }
    ],
    "hashes": {
      "source": "53bd4c2a193116e226c1d1f8cfa89aba1d07601fb77ac7e53cec3b149c800e60",
      "patched": "309a9cc97466fcbcad757d9a4f4b11368ee551635cc77e96e711e56f924f11a1",
      "javascript": "2dd5a3e4839da0a6b4c6d6eca9f5632bcc34b3e73c2e35b4d8291b832a051491",
      "map": "35c4d3b3f6e4e8e7f3c139782d46f6d720d9ef9a5efed2f2f371458ecab7a08c"
    }
  },
  {
    "name": "Sidebar",
    "edits": [
      {
        "before": "        <nav\n          className=",
        "after": "        <nav\n          aria-label=\"Documentation\"\n          className="
      }
    ],
    "hashes": {
      "source": "f93969b132e65eb763004e6f3c0941828f80cbf3eedf22a9efaedf181c3f18af",
      "patched": "dc0822634e7f578a8baf0b3b1140513290e9d00f28cce5d430772d5be5250172",
      "javascript": "ce101be3c6c6afaaff17a3b52afdbd0fb0aea8ac5c8edbde553d40954d1cfde1",
      "map": "bbe67dbcb403de7faff5838739c968ea9236e44d63ff62a584781140e53fad38"
    }
  }
]
export function patchVocsNavigation(root = fileURLToPath(new URL('../', import.meta.url))) {
  return patchVocsModules(root, specs)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = patchVocsNavigation()
    console.log('Vocs ' + result.version + ' navigation labels ' + (result.changed ? 'applied.' : 'already applied.'))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
