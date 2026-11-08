export function divide(provide: number, a: number) {
  return provide / a / { value: 2 }.value
}
export function update(provide: number, a: number) {
  return provide /= a / { value: 2 }.value
}
export function main() {
  return [divide(8, 2), update(8, 2)]
}
