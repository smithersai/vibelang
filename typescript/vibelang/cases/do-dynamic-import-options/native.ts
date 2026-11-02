export async function probe() {
  const events: string[] = []
  const loaded = await import((events.push("specifier"), "./dep.js"), (() => { events.push("options"); return ({ with: {} }) })())
  return [loaded.value, events]
}
