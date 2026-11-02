export async function probe() {
  const events: string[] = []
  const loaded = await (() => { events.push("outer"); return import((() => { events.push("specifier"); return ((() => { events.push("inner"); return "./dep.js" })()) })(), (() => { events.push("options"); return ({ with: {} }) })()) })()
  return [loaded.value, events]
}
