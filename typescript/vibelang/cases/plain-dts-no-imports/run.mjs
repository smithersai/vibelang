// Calls double as TypeScript would: as a plain function that returns a number.
const { double } = await import("./out/main.js")

console.log(double(4))
