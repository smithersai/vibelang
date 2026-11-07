import { Effect } from "effect"
for (const name of ["constant", "variable"]) {
  const m = await import(`./out/${name}.js`)
  console.log(name, m.before, m.after, Effect.runSync(m.main()))
}
