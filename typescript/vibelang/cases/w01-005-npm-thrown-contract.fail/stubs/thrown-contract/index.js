export function unannotated(n) { return n + 1 }
export function neverThrows(n) { return n + 1 }
export function throwsRange(n) { if (n < 0) throw new RangeError("negative"); return n + 1 }
