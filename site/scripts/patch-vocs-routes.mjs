import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { patchVocsModules } from './patch-vocs-module.mjs'

const specs = [
  {
    "name": "router",
    "directory": "waku/internal/patches",
    "sourceExtension": ".ts",
    "sourceRoot": "../../../../src/waku/internal/patches",
    "edits": [
      {
        "before": "const defaultFiles = import.meta.glob(`../routes/**/*.{tsx,ts,js}`)",
        "after": "const defaultFiles = import.meta.glob([`../routes/**/*.{tsx,ts,js}`, '!../routes/**/*.d.ts'])"
      }
    ],
    "hashes": {
      "source": "4424af912d6ac0b15ec6846a704cb026e871e30285d87b566d11f93097a0223d",
      "patched": "3fd46af0e30306402408fc1f5ec17dddbb098ffc59bf6f5783c605417d3325ed",
      "javascript": "2fd93132d9ab6763ddd406f5a0d62740bf1a71a0bdcb3a86c120ee4a36649a1e",
      "map": "04028c4ec52baab5e05485797ca186461fea3015d1fe1b2c596c748e4162ecff"
    }
  },
  {
    "name": "vite-plugins",
    "directory": "waku/internal",
    "sourceExtension": ".ts",
    "sourceRoot": "../../../src/waku/internal",
    "edits": [
      {
        "before": "JSON.stringify(globPattern)",
        "after": "JSON.stringify([globPattern, '!' + globBase + '/**/*.d.ts'])"
      },
      {
        "before": "JSON.stringify(middlewareGlob)",
        "after": "JSON.stringify([middlewareGlob, '!/' + config.srcDir + '/' + SRC_MIDDLEWARE + '/**/*.d.ts'])"
      }
    ],
    "hashes": {
      "source": "af6eca4b218451f64b5580b2eee061a21c06b949d07e20ae3c8cad65ed59b7ec",
      "patched": "402565408a54e8249820e0d77e743fdf972f6af6087a843dc7cfe75fe44018a0",
      "javascript": "e85b6684762cea4f52f561e4f3d048515bd0bc77d9c0c6b27ab6994246fc29e5",
      "map": "64d87e05dc262ebd548212114870f7d1e7d0b291db8ddbf17c4a302d6d2a7d1b"
    }
  }
]
export function patchVocsRoutes(root = fileURLToPath(new URL('../', import.meta.url))) {
  return patchVocsModules(root, specs)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = patchVocsRoutes()
    console.log('Vocs ' + result.version + ' declaration-route filter ' + (result.changed ? 'applied.' : 'already applied.'))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
