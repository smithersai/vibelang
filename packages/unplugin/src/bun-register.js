// A preload for runtime imports and build graphs owned by tools or tests.
// Bun.plugin registers runtime hooks; Bun.build requires its own plugin list.
import "vibelang/bun"
import vibelang from "./bun.js"

const registered = Symbol.for("vibelang-unplugin.bun-register")
if (!Bun.build[registered]) {
  const build = Bun.build
  function buildWithVibe(options) {
    // Let Bun diagnose malformed options. An explicitly configured adapter
    // owns its project/compiler choices and must not be installed twice.
    if (!options || typeof options !== "object" || Array.isArray(options) ||
        (options.plugins !== undefined && !Array.isArray(options.plugins)) ||
        options.plugins?.some((plugin) => plugin?.name === "vibelang")) {
      return build.call(this, options)
    }
    const root = process.cwd()
    const project = process.env.VIBELANG_PROJECT || undefined
    // Each invocation owns its backend: concurrent builds and later builds
    // after source edits cannot reuse another build's in-memory compile.
    const plugin = vibelang({ root, project })
    if (process.env.VIBELANG_UNPLUGIN_DEBUG) console.error("vibelang-unplugin: adding Bun build adapter")
    return build.call(this, { ...options, plugins: [...(options.plugins || []), plugin] })
  }
  Object.defineProperty(buildWithVibe, registered, { value: true })
  Bun.build = buildWithVibe
}
