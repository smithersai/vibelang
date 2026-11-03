// Outside Effect code the same helper is an ordinary TypeScript identifier.
export function opencodeLocalFork() {
  const fork = (n: number) => n + 7
  return fork(3)
}
