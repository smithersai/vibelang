export const sentinel = new RangeError("nested")
export const events: string[] = []
export function risky(value: string): number {
  events.push("call:" + value)
  if (!value) throw sentinel
  return value.length
}
export class Foreign {
  readonly value: string
  constructor(value: string) {
    events.push("new:" + value)
    if (!value) throw sentinel
    this.value = value
  }
}
export function tag(strings: TemplateStringsArray, value: string): number {
  events.push("tag:" + value)
  if (!value) throw sentinel
  return value.length
}
