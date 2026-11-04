export const decoder = () => (input) => { if (typeof input !== "number") throw new RangeError("bad"); return input }
