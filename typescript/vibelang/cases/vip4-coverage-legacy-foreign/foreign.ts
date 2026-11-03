function count(...args: unknown[]) { return arguments.length }
export function legacy(): readonly unknown[] {
  var a = eval("1")
  const b = (0,eval)("2")
  const c = Function("return 3")()
  const d = new Function("return 4")()
  const e = count(1,2)
  const f = new Function("o", "with (o) { return value }")({ value: 5 })
  return [a,b,c,d,e,f]
}
