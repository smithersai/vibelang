import { shellCommands } from "./shell-commands.mjs"

// --no-script selects Bun's built-in TypeScript checker, never a user script
// called check. Bare bun check retains the repository's script semantics.
export function replaceBunCheck(script) {
  let commands
  try { commands = shellCommands(script) } catch { return script }
  let result = script, offset = 0, delta = 0
  for (const { raw, words } of commands) {
    const start = script.indexOf(raw, offset)
    offset = start + raw.length
    if (words[0] !== "bun" || words[1] !== "check" || !/^bun[ \t]+check[ \t]+--no-script(?=[ \t]|$)/.test(raw)) continue
    // Future Bun-only options keep the original command rather than losing flags.
    const build = words.some(word => word === "-b" || word === "--build")
    let valid = true
    const flags = build ? ["--no-script", "--noEmit", "-b", "--build"] : ["--no-script", "--noEmit", "--strict", "--skipLibCheck"]
    if (build && (words.filter(word => word === "-b" || word === "--build").length !== 1 ||
      words.filter(word => word === "-p" || word === "--project").length > 1)) continue
    for (let i = 2; i < words.length; i++) {
      if (flags.includes(words[i])) continue
      if (["-p", "--project"].includes(words[i]) && words[i + 1] && !words[i + 1].startsWith("-")) { i++; continue }
      if (build && !words[i].startsWith("-")) continue
      valid = false
    }
    if (!valid) continue
    let next
    if (build) {
      // Bun accepts project selectors in build mode; TypeScript takes
      // positional projects and requires the build flag first.
      const tokens = raw.match(/(?:[^\s"'\\]|\\[\s\S]|"(?:(?:\\[\s\S])|[^"\\])*"|'[^']*')+/g)
      if (!tokens || tokens.length !== words.length) continue
      const mode = words.findIndex(word => word === "-b" || word === "--build")
      const args = []
      for (let i = 2; i < words.length; i++) {
        if (i === mode || words[i] === "--no-script") continue
        if (words[i] === "-p" || words[i] === "--project") { args.push(tokens[++i]); continue }
        args.push(tokens[i])
      }
      next = ["vibelang", tokens[mode], ...args].join(" ")
    } else next = raw.replace(/^bun\s+check\b/, "vibelang --noEmit").replace(/\s+--no-script(?=\s|$)/, "")
    result = result.slice(0, start + delta) + next + result.slice(offset + delta)
    delta += next.length - raw.length
  }
  return result
}
