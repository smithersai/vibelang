// expect: TS2304 TS2552
export function missing(xs: number[]) {
  for (const x of xs) { void $concurrentIte }
}
export function sourceCandidate(xs: number[]) {
  const $concurrentItems = 1
  for (const x of xs) { void $concurrentIte }
}
