import * as __vibelangNodeURL from "node:url"

// VibeLang source-child loader arguments.
function __vibelangSourceChild<C extends string>(
  command: C,
  args: readonly string[],
  resolveLoader: (specifier: string) => string = specifier => import.meta.resolve(specifier),
): [C, readonly string[]] {
  const unchanged: [C, readonly string[]] = [command, args]
  if (typeof command !== "string" || !args.every(value => typeof value === "string")) return unchanged
  const values = args as readonly string[]
  const parts = command.replace(/\\/g, "/").split("/")
  const runtime = (parts[parts.length - 1] ?? "").toLowerCase().replace(/\.exe$/, "")
  if (runtime !== "node" && runtime !== "nodejs" && runtime !== "bun") return unchanged
  const valueFlags = ["--import", "--require", "-r", "--loader", "--experimental-loader", "--conditions", "-C",
    "--env-file", "--env-file-if-exists", "--watch-path", "--max-old-space-size", "--unhandled-rejections",
    "--preload", "--cwd", "--config", "--define"]
  const boolFlags = ["--experimental-transform-types", "--experimental-strip-types", "--no-experimental-strip-types",
    "--no-warnings", "--disable-warnings", "--enable-source-maps", "--disable-source-maps",
    "--watch", "--watch-preserve-output", "--inspect", "--inspect-brk", "--trace-warnings", "--trace-deprecation",
    "--no-deprecation", "--abort-on-uncaught-exception", "--hot", "--smol", "--silent", "--bun", "--no-clear-screen",
    "--no-install", "--prefer-offline", "--prefer-latest"]
  let at = 0
  for (; at < values.length; at++) {
    const value = values[at]
    if (value === undefined) return unchanged
    if (value === "--") { at++; break }
    if (runtime === "bun" && value === "run") continue
    if (["-e", "--eval", "-p", "--print", "--test", "--check"].includes((value.split("=")[0] ?? ""))) return unchanged
    if (!value.startsWith("-")) break
    const flag = (value.split("=")[0] ?? "")
    if (valueFlags.includes(flag)) {
      if (!value.includes("=")) { if (at + 1 >= values.length) return unchanged; at++ }
    } else if (!boolFlags.includes(flag)) return unchanged
  }
  const entry = values[at]
  if (!entry || /\.d\.(?:vibe\.)?[cm]?ts$/.test(entry) || !/\.(?:[cm]?tsx?|vibex?)$/.test(entry)) return unchanged
  const bun = runtime === "bun"
  const specifier = bun ? "vibelang/bun" : "vibelang/register"
  const resolved = resolveLoader(specifier)
  const path = resolved.startsWith("file:") ? __vibelangNodeURL.fileURLToPath(resolved) : resolved
  const flag = bun ? "--preload" : "--import"
  const sameLoader = (value: string | undefined) => value === specifier || value === resolved || value === path
  const prefix: string[] = []
  for (let i = 0; i < at; i++) {
    const value = values[i]
    if (value === undefined) return unchanged
    if (value === flag && i + 1 < at && sameLoader(values[i + 1])) { i++; continue }
    if (value.startsWith(flag + "=") && sameLoader(value.slice(flag.length + 1))) continue
    prefix.push(value)
  }
  const loader = bun ? path : resolved
  if (bun) return [command, [flag, loader, ...prefix, ...values.slice(at)]]
  const insertion = prefix[prefix.length - 1] === "--" ? prefix.length - 1 : prefix.length
  return [command, [...prefix.slice(0, insertion), flag, loader, ...prefix.slice(insertion), ...values.slice(at)]]
}
