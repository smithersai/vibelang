export function observe(run: () => unknown): string {
  try { run(); return "completed" }
  catch (error) { return error instanceof RangeError ? "RangeError" : "other" }
}
