// Stands in for @types/node, a platform package (its package.json names it), whose globals are platform APIs.
export {}
declare global {
  var process: { cwd(): string }
  var Buffer: { from(text: string): Uint8Array }
}
