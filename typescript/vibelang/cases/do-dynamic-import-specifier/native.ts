export async function probe() {
  const events: string[] = []
  const loaded = await import((() => { events.push("specifier"); return "./dep.js" })())
  return [loaded.value, events]
}
