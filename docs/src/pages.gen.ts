// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages } from 'waku/router'

// prettier-ignore
type Page =
  | { path: '/guide/agent-library'; render: 'static' }
  | { path: '/guide/asset-imports'; render: 'static' }
  | { path: '/guide/capabilities-and-layers'; render: 'static' }
  | { path: '/guide/comptime'; render: 'static' }
  | { path: '/guide/concurrency'; render: 'static' }
  | { path: '/guide/control-flow'; render: 'static' }
  | { path: '/guide/durable-execution'; render: 'static' }
  | { path: '/guide/features'; render: 'static' }
  | { path: '/guide/optionals'; render: 'static' }
  | { path: '/guide/platforms-and-targets'; render: 'static' }
  | { path: '/guide/runtime-validation'; render: 'static' }
  | { path: '/guide/typed-failures'; render: 'static' }
  | { path: '/guide/typescript-interop'; render: 'static' }
  | { path: '/'; render: 'static' }
  | { path: '/introduction/getting-started'; render: 'static' }
  | { path: '/introduction/philosophy'; render: 'static' }
  | { path: '/introduction/why-vibelang'; render: 'static' }
  | { path: '/reference/actions-and-flows'; render: 'static' }
  | { path: '/reference/capabilities'; render: 'static' }
  | { path: '/reference/cli'; render: 'static' }
  | { path: '/reference/comptime'; render: 'static' }
  | { path: '/reference/errors'; render: 'static' }
  | { path: '/reference/function-channels'; render: 'static' }
  | { path: '/reference/language-syntax'; render: 'static' }
  | { path: '/reference/standard-library'; render: 'static' }
  | { path: '/specification/compatibility'; render: 'static' }
  | { path: '/specification/comptime'; render: 'static' }
  | { path: '/specification/control-flow'; render: 'static' }
  | { path: '/specification/durable-execution'; render: 'static' }
  | { path: '/specification/failures'; render: 'static' }
  | { path: '/specification'; render: 'static' }
  | { path: '/specification/requirements'; render: 'static' }
  | { path: '/specification/type-system'; render: 'static' }

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>
  }
  interface CreatePagesConfig {
    pages: Page
  }
}
