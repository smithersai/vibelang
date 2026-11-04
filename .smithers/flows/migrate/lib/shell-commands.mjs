// Literal shell commands shared by migration checker wiring.
export function shellCommands(text) {
  const commands = []
  let start = 0, word = "", words = [], quoted = false, quote = null, escaped = false
  const endWord = () => { if (word || quoted) words.push(word); word = ""; quoted = false }
  const end = i => { endWord(); commands.push({ raw: text.slice(start, i).trim(), words }); words = []; start = i + 2 }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (escaped) { word += c; escaped = false; continue }
    if (c === "\\" && quote !== "'") { escaped = true; continue }
    if (quote) {
      if (c === quote) quote = null
      else { if (quote === '"' && /[$`]/.test(c)) throw new Error("dynamic shell words need manual typecheck wiring"); word += c }
      continue
    }
    if (c === "'" || c === '"') { quote = c; quoted = true; continue }
    if (c === "&" && text[i + 1] === "&") { end(i); i++; continue }
    if (/[|;&()<>$`\n\r]/.test(c)) throw new Error("only literal commands joined by && can be combined")
    if (/\s/.test(c)) endWord()
    else word += c
  }
  if (quote || escaped) throw new Error("unterminated shell word")
  end(text.length)
  if (commands.some(c => !c.words.length)) throw new Error("empty typecheck command")
  return commands
}

