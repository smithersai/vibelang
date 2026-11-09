/** @throws {RangeError} */
export function risky(value: number): number { if (value < 0) throw new RangeError("negative"); return value }
