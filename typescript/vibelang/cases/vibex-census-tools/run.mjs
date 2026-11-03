// VIP-39 A per-file pragma Deno s and Babel s jsx: docs/design/vips/0039-vibex.md#70e3f20da2a7cc91
// VIP-39 Tell users to add .vibex to vite-plugin-solid plugin-react options: docs/design/vips/0039-vibex.md#a61a22aeb4a8028f
// VIP-39 Editor language id vibelangreact Opus The existing id is: docs/design/vips/0039-vibex.md#5707f3aeba33c9b7
import assert from "node:assert/strict"
import {readFileSync,writeFileSync,mkdirSync} from "node:fs"
import {unplugin} from "../../../../packages/unplugin/src/index.js"
const manifest=JSON.parse(readFileSync(new URL("../../../../editors/vscode/package.json",import.meta.url),"utf8"))
const language=manifest.contributes.languages.find(l=>l.id==="vibex")
const results=[
 {key:"editor-vibex",ok:!!language && language.extensions.includes(".vibex")},
 {key:"bundler-vibex",ok:unplugin.raw({}, {framework:"vite"}).loadInclude("/app/Card.vibex")}
]
mkdirSync(new URL("./out",import.meta.url),{recursive:true})
writeFileSync(new URL("./out/census-results.json",import.meta.url),JSON.stringify(results,null,2))
assert.deepEqual(results.filter(r=>!r.ok),[])

console.log("VIP-39 PASS")
