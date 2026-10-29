# Cloudflare Workers

A Worker is a module whose `fetch` handler answers each request. Write the handler in TypeScript and the program in VibeLang: the handler runs the program with an Effect runner. esbuild bundles both through `vibelang-unplugin`, and Wrangler runs the bundle locally in workerd, Cloudflare's runtime.

## Install

```sh
npm install effect vibelang-runtime
npm install -D vibelang vibelang-unplugin esbuild wrangler
```

## Configure

Keep a normal `tsconfig.json` that includes the `.vibe` sources: the plugin compiles with it, and without one the build stops with TS5058.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src/**/*.ts", "src/**/*.vibe"]
}
```

`build.mjs` bundles the Worker into one ES module, with the export conditions workerd resolves:

```js
// build.mjs
import * as esbuild from "esbuild"
import vibelang from "vibelang-unplugin/esbuild"

await esbuild.build({
  entryPoints: ["src/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["workerd", "worker"],
  outfile: "dist/worker.js",
  plugins: [vibelang()]
})
```

`wrangler.toml` runs that build and serves its output unbundled:

```toml
name = "greeter"
main = "dist/worker.js"
compatibility_date = "2026-10-01"
no_bundle = true

[build]
command = "node build.mjs"
```

## Write the Worker

```vibe
// src/greeter.vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-9, VIP-12, VIP-13, VIP-14
export error EmptyName

service Greeter {
  greet(name: string): string!EmptyName
}

const GreeterLive = Layer.succeed(Greeter, {
  effect greet(name) {
    if (name.length === 0) throw new EmptyName()
    return `Hello, ${name}!`
  }
})

export effect function greeting(name: string) {
  provide GreeterLive {
    const greeter = try Greeter
    return greeter.greet(name) catch "Hello, stranger!"
  }
}
```

```ts
// src/worker.ts
import { Effect } from "effect"
import { greeting } from "./greeter.vibe"

export default {
  async fetch(request: Request): Promise<Response> {
    const name = new URL(request.url).searchParams.get("name") ?? "Worker"
    return new Response(await Effect.runPromise(greeting(name)))
  }
}
```

A Worker has no `main`; its TypeScript `fetch` callback runs each request Effect with `Effect.runPromise`. Provide each program's layers where it runs, as `greeting` does; `HttpClient` takes `FetchHttpClient.layer`, which calls the Worker's own `fetch`.

## Run it locally

```sh
npx wrangler dev
curl "http://localhost:8787/?name=Ada"
# Hello, Ada!
curl "http://localhost:8787/?name="
# Hello, stranger!
```

`npx wrangler deploy` runs the same build and uploads it to your Cloudflare account.
