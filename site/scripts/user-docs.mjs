// Publication-only cleanup. Source comments remain available to the snippet harness.
function mapLines(markdown, transform) {
  let fence
  return markdown.split('\n').flatMap((line) => {
    const bare = line.trimStart()
    const marker = /^(`{3,}|~{3,})/.exec(bare)?.[1]
    if (fence === undefined && marker) {
      fence = marker
      return [line]
    }
    if (fence !== undefined && marker?.[0] === fence[0] && marker.length >= fence.length && bare.trimEnd() === marker) {
      fence = undefined
      return [line]
    }
    const result = transform(line, fence !== undefined)
    return result === undefined ? [] : [result]
  }).join('\n')
}

// A pending line names the VIPs a block waits for; only the snippet checker reads it.
export function stripRunDirectives(markdown) {
  return mapLines(markdown, (line, code) => code && /^\s*\/\/\s*(?:run|pending|pending-decision):/.test(line) ? undefined : line)
}

// Decision IDs belong to the spec. Remove only comma-separated annotations;
// prose that depends on a decision is rewritten in the source instead.
const decision = String.raw`D\d+(?:\s*(?:[-–]|to)\s*D?\d+)?`
const list = `${decision}(?:,\\s*${decision})*`
const only = new RegExp(` ?\\(${list}\\)`, 'g')
const first = new RegExp(`\\(${list},\\s*`, 'g')
const last = new RegExp(`,\\s*${list}\\)`, 'g')
const strip = (text) => text.replace(only, '').replace(first, '(').replace(last, ')')

export function stripDecisionReferences(markdown) {
  return mapLines(markdown, (line, code) => {
    if (code) return line
    let result = '', offset = 0
    for (const match of line.matchAll(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g)) {
      result += strip(line.slice(offset, match.index)) + match[0]
      offset = match.index + match[0].length
    }
    return result + strip(line.slice(offset))
  })
}
