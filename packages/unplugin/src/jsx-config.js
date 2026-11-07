import { spawn } from "node:child_process"
import { dirname } from "node:path"

export function jsxConfigReader({ compiler, compilerCommand, debug = () => {} }) {
  const cache = new Map(), children = new Set(), pending = new Set()
  let closed = false, closing
  const waitFor = (work, ms) => {
    let timer
    return Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, ms) })])
      .finally(() => clearTimeout(timer))
  }
  const terminate = signal => {
    for (const child of children) {
      try {
        if (process.platform === "win32") child.kill(signal)
        else process.kill(-child.pid, signal)
      } catch (error) { if (error.code !== "ESRCH") throw error }
    }
  }
  return {
    read(project) {
      if (closed) return Promise.reject(new Error("vibelang: JSX configuration reader is closed"))
      if (cache.has(project)) return cache.get(project)
      debug(`JSX configuration start ${project}`)
      const [file, argv] = compilerCommand(compiler, ["--project", project, "--showConfig"])
      const work = new Promise((accept, reject) => {
        let output = "", failure
        const child = spawn(file, argv, { cwd: dirname(project), env: { ...process.env, VIBELANG_COMPILER_PARENT_PID: String(process.pid) }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
        children.add(child)
        child.stdout.setEncoding("utf8").on("data", data => { output += data })
        child.stderr.resume()
        child.on("error", error => { failure = error })
        child.on("close", (status, signal) => {
          children.delete(child)
          debug(`JSX configuration finish ${project}; status=${status}, signal=${signal ?? "none"}`)
          if (failure) return reject(new Error(`vibelang: cannot read JSX configuration: ${failure.code}`))
          if (closed) return reject(new Error("vibelang: JSX configuration reader is closed"))
          if (status !== 0) return reject(new Error(`vibelang: cannot read JSX configuration for ${project}; compiler exited ${status ?? signal}`))
          try {
            const options = JSON.parse(output).compilerOptions ?? {}
            accept({ compilerOptions: Object.fromEntries(["jsx", "jsxFactory", "jsxFragmentFactory", "jsxImportSource"].filter(key => options[key] !== undefined).map(key => [key, options[key]])) })
          } catch {
            reject(new Error(`vibelang: compiler returned invalid JSX configuration for ${project}`))
          }
        })
      })
      cache.set(project, work)
      pending.add(work)
      work.then(() => pending.delete(work), () => pending.delete(work))
      return work
    },
    close() {
      closed = true
      return closing ??= (async () => {
        const done = Promise.allSettled([...pending])
        await waitFor(done, 500)
        terminate("SIGTERM")
        await waitFor(done, 500)
        terminate("SIGKILL")
        for (const child of children) { child.stdout.destroy(); child.stderr.destroy() }
        await done
        cache.clear()
        await new Promise(resolve => setImmediate(resolve))
        await new Promise(resolve => setImmediate(resolve))
      })()
    }
  }
}
