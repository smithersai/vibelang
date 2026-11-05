export const sentinel = new Error("validation")
export function check(fail: boolean): string {
  if (fail) throw sentinel
  return "ok"
}
