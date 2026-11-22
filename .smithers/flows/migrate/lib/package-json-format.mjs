// Manifest edits that keep the author's bytes. A package.json is rewritten
// from its own text: every value the edit leaves alone keeps its source slice,
// so indentation, line endings, the final newline and string escapes survive,
// and an edit followed by its inverse returns the original file.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The syntax tree of valid JSON text: scalars and containers with source offsets. */
function scan(text) {
  let at = 0
  const space = () => { while (at < text.length && " \t\n\r".includes(text[at])) at++ }
  const string = () => {
    at++
    while (text[at] !== '"') at += text[at] === "\\" ? 2 : 1
    at++
  }
  const value = () => {
    space()
    const start = at
    if (text[at] !== "{" && text[at] !== "[") {
      if (text[at] === '"') string()
      else while (at < text.length && !",]} \t\n\r".includes(text[at])) at++
      return { kind: "scalar", start, end: at }
    }
    const object = text[at] === "{", close = object ? "}" : "]", members = []
    at++
    space()
    while (text[at] !== close) {
      const member = { start: at }
      if (object) {
        string()
        member.key = JSON.parse(text.slice(member.start, at))
        space()
        at++
      }
      member.node = value()
      member.end = at
      members.push(member)
      space()
      if (text[at] === ",") at++
      space()
    }
    at++
    return { kind: object ? "object" : "array", start, end: at, members }
  }
  return value()
}

const stringToken = /"(?:[^"\\]|\\.)*"/gs

/** printed JSON with each string escaped as the strings of raw, the text it replaces, escape that character. */
function escapedLike(raw, printed) {
  const style = new Map()
  for (const literal of raw.match(stringToken) ?? []) {
    for (const token of literal.slice(1, -1).match(/\\u[0-9a-fA-F]{4}|\\.|[^\\]/gs) ?? []) {
      const char = JSON.parse('"' + token + '"')
      if (token !== JSON.stringify(char).slice(1, -1) && !style.has(char)) style.set(char, token)
    }
  }
  if (!style.size) return printed
  return printed.replace(stringToken, literal => '"' + [...JSON.parse(literal)].map(char => style.get(char) ?? JSON.stringify(char).slice(1, -1)).join("") + '"')
}

/**
 * The text of a manifest whose value becomes next, given its text before.
 * Unchanged values keep their bytes. A changed value keeps the escapes of the
 * text it replaces, a container whose members were added, removed or changed in place keeps the
 * layout of the members that stay, and only a reordered or retyped value is
 * printed anew, in the file's own indentation. Without earlier text the
 * manifest takes two-space indentation and a final newline.
 */
export function manifestText(before, next) {
  if (typeof before !== "string") return JSON.stringify(next, null, 2) + "\n"
  const root = scan(before)
  const eol = before.includes("\r\n") ? "\r\n" : "\n"
  const unit = /\n([ \t]+)"/.exec(before)?.[1] ?? (before.trimEnd().includes("\n") ? "  " : "")
  const fresh = (value, depth) => (unit ? JSON.stringify(value, null, unit) : JSON.stringify(value)).split("\n").join(eol + unit.repeat(depth))
  const edit = (node, value, depth) => {
    const raw = before.slice(node.start, node.end), prior = JSON.parse(raw)
    if (same(prior, value)) return raw
    const array = Array.isArray(value)
    if (node.kind === "scalar" || value === null || typeof value !== "object" || array !== (node.kind === "array")) return escapedLike(raw, fresh(value, depth))
    const members = node.members
    const entries = array ? value.map(item => [undefined, item]) : Object.entries(value)
    if (!members.length || !entries.length) return fresh(value, depth)
    // Pair each entry of the new value with the member it keeps, in order.
    const kept = new Array(entries.length)
    if (array) {
      if (entries.length === members.length) members.forEach((member, i) => { kept[i] = member })
      else {
        const longer = entries.length > members.length
        const priors = members.map(member => JSON.parse(before.slice(member.node.start, member.node.end)))
        let matched = 0
        for (let i = 0, j = 0; i < entries.length && j < members.length;) {
          if (same(priors[j], entries[i][1])) { kept[i++] = members[j++]; matched++ }
          else if (longer) i++
          else j++
        }
        if (matched !== Math.min(entries.length, members.length)) return fresh(value, depth)
      }
    } else {
      // Duplicate keys and integer-like keys have no single textual order.
      if (!same(members.map(member => member.key), Object.keys(prior))) return fresh(value, depth)
      const byKey = new Map(members.map((member, index) => [member.key, { member, index }]))
      let last = -1
      for (const [i, [key]] of entries.entries()) {
        const found = byKey.get(key)
        if (!found) continue
        if (found.index < last) return fresh(value, depth)
        last = found.index
        kept[i] = found.member
      }
    }
    const lead = member => before.slice(member === members[0] ? node.start + 1 : members[members.indexOf(member) - 1].end, member.start)
    const first = lead(members[0])
    const separator = members.length > 1 ? lead(members[1]) : "," + first
    const colon = array ? "" : before.slice(members[0].start, members[0].node.start).slice(JSON.stringify(members[0].key).length)
    let text = before[node.start]
    for (const [i, [key, item]] of entries.entries()) {
      const member = kept[i]
      text += i === 0 ? first : member && member !== members[0] ? lead(member) : separator
      text += member
        ? before.slice(member.start, member.node.start) + edit(member.node, item, depth + 1)
        : (array ? "" : JSON.stringify(key) + (colon.trim() === ":" ? colon : ": ")) + fresh(item, depth + 1)
    }
    return text + before.slice(members.at(-1).end, node.end)
  }
  return before.slice(0, root.start) + edit(root, next, 0) + before.slice(root.end)
}
