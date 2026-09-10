import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'
import { fileURLToPath } from 'node:url'

const docsDir = fileURLToPath(new URL('.', import.meta.url))

export default Alchemy.Stack(
  'VibeLangDocs',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Website.StaticSite('Website', {
      command: 'npm run build',
      cwd: docsDir,
      outdir: 'dist/public',
      dev: {
        command: 'npm run dev',
      },
      domain: 'vibelang.sh',
      workersDev: false,
      assets: {
        htmlHandling: 'drop-trailing-slash',
        notFoundHandling: '404-page',
      },
    })

    return { url: site.url }
  }),
)
