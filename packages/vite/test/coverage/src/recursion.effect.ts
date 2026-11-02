const strings = (value: unknown, out: Array<string>): Array<string> => {
  if (typeof value === "string") {
    out.push(value)
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      out.push(key)
      strings(item, out)
    }
  }
  return out
}

export const collect = (value: unknown): Array<string> => strings(value, [])
