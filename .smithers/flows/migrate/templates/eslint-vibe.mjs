// Written by VibeLang's setup; a rerun refreshes it. A repository that runs
// ESLint itself names its files as *.ts, in its configurations and in the
// helpers they share, so a .vibe module meets none of its rules. withVibe gives
// a flat configuration's TypeScript blocks to the matching .vibe files too, has
// vibelang/eslint parse them, and keeps ESLint off the files vibelang writes.
import parser from "vibelang/eslint"

const extension = /\.(?:[cm]?tsx?|\{([^{}]*)\})$/

/** The .vibe glob a TypeScript glob stands for, or null: a declaration file has none. */
export function vibeGlob(glob) {
  if (typeof glob !== "string" || /\.d\.[^/]*$/.test(glob)) return null
  const match = extension.exec(glob)
  if (!match) return null
  if (match[1] !== undefined && !match[1].split(",").some((name) => /^[cm]?tsx?$/.test(name.trim()))) return null
  return glob.slice(0, match.index) + ".vibe"
}

// A nested array means every glob in it must match, so it keeps its other
// members: [["src/**/*.ts", "**/*.ts"]] adds ["src/**/*.vibe", "**/*.vibe"].
function vibeEntry(entry) {
  if (!Array.isArray(entry)) return vibeGlob(entry)
  const next = entry.map((glob) => vibeGlob(glob) ?? glob)
  return next.some((glob, i) => glob !== entry[i]) ? next : null
}

function withVibeGlobs(entries) {
  const known = new Set(entries.map((entry) => JSON.stringify(entry)))
  const added = []
  for (const entry of entries) {
    const next = vibeEntry(entry)
    if (next !== null && !known.has(JSON.stringify(next))) {
      known.add(JSON.stringify(next))
      added.push(next)
    }
  }
  return [...entries, ...added]
}

// Rules that need type information cannot run: vibelang/eslint has no
// TypeScript program. `vibelang -p` type-checks these files.
function typedRulesOff(blocks) {
  const plugins = Object.assign({}, ...blocks.map((block) => block.plugins ?? {}))
  const off = {}
  for (const block of blocks) {
    for (const rule of Object.keys(block.rules ?? {})) {
      const at = rule.lastIndexOf("/")
      const definition = at < 0 ? undefined : plugins[rule.slice(0, at)]?.rules?.[rule.slice(at + 1)]
      if (definition?.meta?.docs?.requiresTypeChecking) off[rule] = "off"
    }
  }
  return off
}

// eslint-plugin-import parses a module it follows with the parser its
// extension maps to, and follows only the extensions it is told about. Both
// apply to .ts files importing a .vibe module, so this block has no files.
function importSettings(blocks) {
  const settings = {}
  for (const name of ["import", "import-x"]) {
    if (!blocks.some((block) => block.plugins?.[name])) continue
    const known = blocks.map((block) => block.settings?.[`${name}/extensions`]).filter(Boolean).at(-1) ?? [".js", ".mjs", ".cjs", ".jsx"]
    settings[`${name}/extensions`] = [...new Set([...known, ".vibe"])]
    settings[`${name}/parsers`] = { "vibelang/eslint": [".vibe"] }
  }
  return settings
}

/** A flat configuration, or a promise of one, whose TypeScript blocks also apply to .vibe files. */
export function withVibe(config) {
  if (typeof config?.then === "function") return config.then(withVibe)
  const blocks = [config].flat(Infinity).map((block) => ({
    ...block,
    ...(Array.isArray(block.files) ? { files: withVibeGlobs(block.files) } : {}),
    ...(Array.isArray(block.ignores) ? { ignores: withVibeGlobs(block.ignores) } : {})
  }))
  const settings = importSettings(blocks)
  return [
    { ignores: ["**/*.d.vibe.ts", "**/.vibelang/js/**"] },
    ...blocks,
    ...(Object.keys(settings).length ? [{ settings }] : []),
    { files: ["**/*.vibe"], languageOptions: { parser }, rules: typedRulesOff(blocks) }
  ]
}
