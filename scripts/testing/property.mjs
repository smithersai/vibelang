import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const home = homedir()
const portable = (value) => String(value ?? "")
  .replaceAll(pathToFileURL(root).href, "file:///<repo>").replaceAll(root, "<repo>")
  .replaceAll(pathToFileURL(home).href, "file:///<home>").replaceAll(home, "<home>")
const quote = (text) => `'${String(text).replaceAll("'", "'\\''")}'`
const bounded = (value) => portable(value).slice(-12000)

function integer(env, name, fallback, min, max) {
  if (env[name] === undefined) return fallback
  const value = Number(env[name])
  if (!/^-?\d+$/.test(env[name]) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`)
  }
  return value
}

function* savedRegressions(regressions, name) {
  if (!regressions || !existsSync(regressions)) return
  for (const file of readdirSync(regressions).filter((file) => file.endsWith(".json")).sort()) {
    const regression = JSON.parse(readFileSync(new URL(file, regressions), "utf8"))
    if (regression.property === name) yield { file, regression }
  }
}

/** Caller owns fast-check and the runner. Inputs and regression JSON contain data, never closures. */
export async function checkProperty(fc, {
  name, rule, command, arbitrary, check, numRuns = 50, generatorVersion = 1,
  regressions, artifacts = () => ({}), diagnostics = () => "", env = process.env
}) {
  if (env.FC_PATH !== undefined && !env.FC_PROPERTY) throw new Error("FC_PATH requires FC_PROPERTY")
  if (env.FC_PROPERTY && env.FC_PROPERTY !== name) return
  // Saved inputs survive generator changes; replay them before starting discovery.
  for (const { file, regression } of savedRegressions(regressions, name)) {
    if (!regression.knownFailure) await check(regression.input)
    else {
      let failed = false
      try { await check(regression.input) } catch { failed = true }
      if (!failed) throw new Error(`XPASS ${file}: remove knownFailure (${regression.rule})`)
      process.stderr.write(`known failure ${file}: ${regression.rule}\n`)
    }
  }
  const parameters = {
    numRuns: integer(env, "FC_RUNS", numRuns, 1, Number.MAX_SAFE_INTEGER),
    ...(env.FC_SEED === undefined ? {} : { seed: integer(env, "FC_SEED", 0, -2147483648, 2147483647) }),
    ...(env.FC_PATH === undefined ? {} : { path: env.FC_PATH })
  }
  process.stderr.write(`property ${name}: ${parameters.numRuns} runs (${rule})\n`)
  const result = await fc.check(fc.asyncProperty(arbitrary, check), parameters)
  if (!result.failed && !result.interrupted) return
  const input = result.counterexample?.[0]
  const replay = `FC_PROPERTY=${quote(name)} FC_SEED=${result.seed} FC_PATH=${quote(result.counterexamplePath ?? "")} ${command}`
  const directory = resolve(env.FC_ARTIFACT_DIR || join(".cache", "property-failures"), name)
  mkdirSync(directory, { recursive: true })
  const record = {
    property: name, rule, input, seed: result.seed, counterexamplePath: result.counterexamplePath,
    generatorVersion, fastCheckVersion: fc.__version, command, replay,
    numRuns: result.numRuns, numShrinks: result.numShrinks,
    error: bounded(result.errorInstance?.stack ?? result.errorInstance), diagnostics: bounded(diagnostics())
  }
  writeFileSync(join(directory, "failure.json"), JSON.stringify(record, null, 2) + "\n")
  if (input !== undefined) {
    for (const [file, contents] of Object.entries(await artifacts(input))) {
      const target = resolve(directory, file)
      if (!target.startsWith(directory + "/")) throw new Error(`unsafe property artifact path: ${file}`)
      mkdirSync(resolve(target, ".."), { recursive: true })
      writeFileSync(target, contents)
    }
  }
  throw new Error(portable(`property ${name} failed; saved ${directory}/failure.json\nReplay from ${process.cwd()}:\n${replay}\n${record.error}\n${record.diagnostics}`),
    { cause: result.errorInstance })
}
