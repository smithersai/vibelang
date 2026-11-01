// RC-11: every label in a chain denotes the same native iteration statement.
export function doubleOuter(): number {
  let total = 0
  outer: inner: for (const x of [1, 2]) {
    total += x
    continue outer
  }
  return total
}

export function doubleInner(): number {
  let total = 0
  outer: inner: for (const x of [1, 2]) {
    total += x
    continue inner
  }
  return total
}

export function single(): number {
  let total = 0
  outer: for (const x of [1, 2]) {
    total += x
    continue outer
  }
  return total
}

export function breakOuter(): number {
  let total = 0
  outer: inner: for (const x of [1, 2]) {
    total += x
    break outer
  }
  return total
}

export function tripleOuter(): number {
  let total = 0
  outer: middle: inner: for (const x of [1, 2]) {
    total += x
    continue outer
  }
  return total
}

export function tripleMiddle(): number {
  let total = 0
  outer: middle: inner: for (const x of [1, 2]) {
    total += x
    continue middle
  }
  return total
}

