import { existsSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

// Bundler watchers cannot reliably follow directories created after a failed
// build, and Rollup cannot safely share removable directory watches with
// source-file watches. Observe unresolved candidates and notify the bundler
// through one ordinary file that is updated in place.
export function missingSourceWatcher(debug = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-watch-"))
  const file = join(directory, "changed")
  writeFileSync(file, "0")
  const targets = new Map(), watchers = new Map()
  let timer, revision = 0, closed = false, failure
  const acknowledge = () => { clearInterval(timer); timer = undefined }
  function write() {
    try {
      writeFileSync(file, String(++revision))
      debug(`missing source signal ${revision}`)
    } catch (error) {
      acknowledge()
      failure = error
      process.emitWarning(`vibelang-unplugin cannot signal a source change: ${error.message}`)
    }
  }
  function notify() {
    if (closed || timer) return
    write()
    // An event can arrive before the bundler finishes arming its error watches.
    // Keep it pending until the next build acknowledges the notification.
    timer = setInterval(write, 100)
    timer.unref()
  }
  const parent = target => {
    let path = dirname(target)
    while (!existsSync(path) && dirname(path) !== path) path = dirname(path)
    return path
  }
  function refresh() {
    const needed = new Set()
    let changed = false
    for (const [target, state] of targets) {
      const path = parent(target), present = existsSync(target)
      if (path !== state.parent || present !== state.present) changed = true
      state.parent = path
      state.present = present
      needed.add(path)
    }
    for (const path of needed) {
      if (watchers.has(path)) continue
      const watcher = watch(path, (_event, name) => {
        if (closed) return
        const changedPath = name == null ? path : resolve(path, name.toString())
        if (![...targets.keys()].some(target => target === changedPath || target.startsWith(changedPath + sep))) return
        try {
          const changed = refresh()
          if (name != null || changed) notify()
        } catch (error) {
          failure = error
          notify()
        }
      })
      watcher.on("error", error => {
        watcher.close()
        watchers.delete(path)
        failure = error
        notify()
      })
      watchers.set(path, watcher)
      debug(`missing source watch armed ${path}`)
    }
    for (const [path, watcher] of watchers) {
      if (!needed.has(path)) { watcher.close(); watchers.delete(path) }
    }
    if (changed) notify()
    return changed
  }
  function clear() {
    acknowledge()
    for (const watcher of watchers.values()) watcher.close()
    watchers.clear()
    targets.clear()
    failure = undefined
  }
  return {
    file,
    begin() {
      if (timer) debug(`missing source signal ${revision} acknowledged by build`)
      acknowledge()
    },
    add(paths) {
      if (closed) return
      if (failure) throw failure
      for (const target of paths) if (!targets.has(target)) targets.set(target, { parent: parent(target), present: false })
      refresh()
    },
    finish(error) { if (!error) clear() },
    close() {
      closed = true
      clear()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
