import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' }

// What the host returns for a path: only the built output, with no dev-server
// CSS or production assets.
export async function builtResponse(root, pathname) {
  const path = resolve(root, '.' + decodeURIComponent(pathname))
  if (path !== root && !path.startsWith(root + sep)) return { status: 403, contentType: 'text/plain', body: 'Forbidden' }
  for (const file of [path, resolve(path, 'index.html'), path + '.html']) {
    try {
      return { status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body: await readFile(file) }
    } catch {}
  }
  return { status: 404, contentType: 'text/plain', body: 'Not found' }
}

// Routes the whole origin in the Vocs baseUrl, which also controls dynamic
// imports, to this build, including hydration chunks missing from production.
// Files answer directly: a local server drops idle keep-alive sockets as the
// Playwright request API reuses them, which fails the request with ECONNRESET.
export async function routeBuiltSite(context, root) {
  await context.route('https://vibelang.sh/**', async route => {
    const { pathname } = new URL(route.request().url())
    await route.fulfill(await builtResponse(root, pathname))
  })
}
