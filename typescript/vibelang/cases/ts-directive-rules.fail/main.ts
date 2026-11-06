// @vibe
export function plain(n: number) {
  if (n < 0) throw new Error("negative")
  return n
}
