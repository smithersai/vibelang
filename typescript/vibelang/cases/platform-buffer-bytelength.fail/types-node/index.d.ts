// Stands in for @types/node, a platform package (its package.json names it), whose globals are platform APIs.
export {}
declare global {
  var Buffer: { byteLength(value: string | Uint8Array, encoding?: string): number }
}
