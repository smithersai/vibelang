import { readFileSync, statfsSync } from 'node:fs'
import { freemem, loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'

function resources() {
  const read = path => {
    try { return readFileSync(path, 'utf8').trim() } catch { return undefined }
  }
  const group = read('/proc/self/cgroup')?.split('\n').find(line => line.startsWith('0::'))?.slice(3)
  const memory = name => read('/sys/fs/cgroup/' + name) ?? (group ? read(join('/sys/fs/cgroup', group, name)) : undefined)
  const disk = statfsSync(tmpdir())
  return {
    temporaryFreeBytes: disk.bavail * disk.bsize,
    hostOomKills: read('/proc/vmstat')?.match(/^oom_kill (\d+)$/m)?.[1],
    freeMemoryBytes: freemem(),
    load: loadavg(),
    nodeRssBytes: process.memoryUsage().rss,
    cgroupMemoryBytes: memory('memory.current'),
    cgroupMemoryLimit: memory('memory.max'),
    cgroupMemoryEvents: memory('memory.events'),
    memoryPressure: read('/proc/pressure/memory'),
  }
}

// Report the exact operation before entering Chromium. A renderer crash may
// happen between completed metrics, so completed observations alone lose it.
export function contrastDiagnostics({ log = console.log, snapshot = resources } = {}) {
  let current = { phase: 'launch' }
  let sequence = 0
  const report = (event, extra = {}) => {
    log('site contrast diagnostic:', JSON.stringify({ event, ...current, ...extra, resources: snapshot() }))
  }
  return {
    event: report,
    watch(page, details) {
      page.on('crash', () => report('renderer-crash', details))
      page.on('requestfailed', request => {
        const url = new URL(request.url())
        report('request-failed', { ...details, requestPath: url.pathname, error: request.failure()?.errorText })
      })
    },
    async run(phase, details, operation) {
      current = { sequence: ++sequence, phase, ...details }
      const started = performance.now()
      report('start')
      try {
        const result = await operation()
        report('complete', { elapsedMs: Math.round(performance.now() - started) })
        return result
      } catch (error) {
        report('failed', { elapsedMs: Math.round(performance.now() - started), error: error.message })
        throw error
      }
    },
  }
}
