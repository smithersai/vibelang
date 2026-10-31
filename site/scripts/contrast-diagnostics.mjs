import { readFileSync, readlinkSync, readdirSync, statfsSync } from 'node:fs'
import { freemem, totalmem, hostname, loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'


// Report fixed executable classes, never process arguments or command names.
export function processMemory({ list = () => readdirSync('/proc'), read = path => readFileSync(path, 'utf8'), link = path => readlinkSync(path) } = {}) {
  let pids
  try { pids = list() } catch { return undefined }
  const groups = Object.fromEntries(['goTools', 'testBinaries', 'javascript', 'chromium', 'other'].map(name => [name, { count: 0, rssBytes: 0 }]))
  let unreadable = 0
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue
    try {
      let name = read('/proc/' + pid + '/comm').trim()
      try { name = link('/proc/' + pid + '/exe').split('/').at(-1).replace(/ \(deleted\)$/, '') } catch {}
      const rss = read('/proc/' + pid + '/status').match(/^VmRSS:\s+(\d+)\s+kB$/m)
      if (!rss) continue
      const group = /\.test$|\.tes?$/.test(name) ? 'testBinaries' :
        /^(go|compile|link|asm|tsc)$/.test(name) || name.startsWith('vibelang') ? 'goTools' :
        /^(node|bun|esbuild|rollup|vite|tsserver)$/.test(name) ? 'javascript' :
        /^(chrome|chromium|headless_shell)/.test(name) ? 'chromium' : 'other'
      groups[group].count++
      groups[group].rssBytes += Number(rss[1]) * 1024
    } catch { unreadable++ }
  }
  return { groups, unreadable }
}

function resources() {
  const read = path => {
    try { return readFileSync(path, 'utf8').trim() } catch { return undefined }
  }
  const group = read('/proc/self/cgroup')?.split('\n').find(line => line.startsWith('0::'))?.slice(3)
  const memory = name => read('/sys/fs/cgroup/' + name) ?? (group ? read(join('/sys/fs/cgroup', group, name)) : undefined)
  const disk = statfsSync(tmpdir())
  const available = read('/proc/meminfo')?.match(/^MemAvailable:\s+(\d+)\s+kB$/m)
  const status = read('/proc/self/status')
  const accounting = memory('memory.stat')
  const memoryAccounting = accounting ? Object.fromEntries(
    ['anon', 'file', 'shmem', 'kernel', 'slab', 'file_mapped', 'file_dirty', 'file_writeback']
      .map(key => [key, Number(accounting.match(new RegExp('^' + key + ' (\\d+)$', 'm'))?.[1] ?? 0)]),
  ) : undefined
  return {
    host: hostname(),
    temporaryFreeBytes: disk.bavail * disk.bsize,
    hostOomKills: read('/proc/vmstat')?.match(/^oom_kill (\d+)$/m)?.[1],
    freeMemoryBytes: freemem(),
    totalMemoryBytes: totalmem(),
    availableMemoryBytes: available ? Number(available[1]) * 1024 : undefined,
    memoryNodesAllowed: status?.match(/^Mems_allowed_list:\s*(.*)$/m)?.[1],
    cpusAllowed: status?.match(/^Cpus_allowed_list:\s*(.*)$/m)?.[1],
    processMemory: processMemory(),
    load: loadavg(),
    nodeRssBytes: process.memoryUsage().rss,
    cgroupMemoryBytes: memory('memory.current'),
    cgroupMemoryLimit: memory('memory.max'),
    cgroupMemoryEvents: memory('memory.events'),
    memoryAccounting,
    memoryPressure: read('/proc/pressure/memory'),
  }
}

// Report the exact operation before entering Chromium. A renderer crash may
// happen between completed metrics, so completed observations alone lose it.
export function contrastDiagnostics({ log = console.log, snapshot = resources } = {}) {
  let current = { phase: 'launch', active: false }
  let sequence = 0
  const report = (event, extra = {}) => {
    log('site contrast diagnostic:', JSON.stringify({ event, ...current, ...extra, resources: snapshot() }))
  }
  return {
    event: report,
    async watchBrowser(browser) {
      const session = await browser.newBrowserCDPSession()
      session.on('Target.targetCrashed', ({ status, errorCode }) => report('target-crash-status', { status, errorCode }))
      await session.send('Target.setDiscoverTargets', { discover: true })
    },
    watch(page, details) {
      page.on('crash', () => report('renderer-crash', details))
      page.on('requestfailed', request => {
        const url = new URL(request.url())
        report('request-failed', { ...details, requestPath: url.pathname, error: request.failure()?.errorText })
      })
    },
    async run(phase, details, operation) {
      current = { sequence: ++sequence, phase, ...details, active: true }
      const started = performance.now()
      report('start')
      try {
        const result = await operation()
        current.active = false
        report('complete', { elapsedMs: Math.round(performance.now() - started) })
        return result
      } catch (error) {
        current.active = false
        report('failed', { elapsedMs: Math.round(performance.now() - started), error: error.message })
        throw error
      }
    },
  }
}
