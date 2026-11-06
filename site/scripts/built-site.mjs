import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.mp4': 'video/mp4' }

// What the host returns for a path: only the built output, with no dev-server
// CSS or production assets.
export async function builtResponse(root, pathname, range) {
  const path = resolve(root, '.' + decodeURIComponent(pathname))
  if (path !== root && !path.startsWith(root + sep)) return { status: 403, contentType: 'text/plain', body: 'Forbidden' }
  for (const file of [path, resolve(path, 'index.html'), path + '.html']) {
    try {
      const body = await readFile(file)
      const headers = { 'accept-ranges': 'bytes' }
      const response = { status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', headers, body }
      // Ignore unsupported multiple ranges, as a static host may. A single
      // valid but unsatisfiable range needs an explicit empty 416 response.
      const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '')
      if (!match || (!match[1] && !match[2])) return response
      const start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]))
      const end = match[1] && match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1
      if (start >= body.length || end < start) {
        return { ...response, status: 416, headers: { ...headers, 'content-range': 'bytes */' + body.length }, body: Buffer.alloc(0) }
      }
      return {
        ...response, status: 206,
        headers: { ...headers, 'content-range': 'bytes ' + start + '-' + end + '/' + body.length },
        body: body.subarray(start, end + 1),
      }
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
    await route.fulfill(await builtResponse(root, pathname, route.request().headers().range))
  })
}
