// A TypeScript module that stays TypeScript. Nothing says what it throws.
export const seen: Array<string> = []
export const note = (message: string): void => {
  seen.push(message)
}
export const size = (message: string): number => message.length
