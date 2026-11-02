// RC-33: compare every source naming context with native IIFE returns.
export function names(): unknown[] {
 const out: unknown[] = []
 const arrow = (() => { return (): number => 1 })()
 const fn = (() => { return (function (): number { return 1 }) })()
 const C = (() => { return (class { static observed = this.name }) })()
 out.push(arrow.name, fn.name, [C.name, C.observed])
 const array = [(): number => 1, (() => { return 2 })()] as const
 const classes = [class { static observed = this.name }, (() => { return 2 })()] as const
 out.push(array[0].name, [classes[0].name, classes[0].observed])
 const object = { f: (): number => 1, C: class { static observed = this.name }, x: (() => { return 2 })() }
 out.push(object.f.name, [object.C.name, object.C.observed])
 const quoted = { "a-b": function (): number { return 1 }, 7: class { static observed = this.name }, x: (() => { return 2 })() }
 out.push(quoted["a-b"].name, [quoted[7].name, quoted[7].observed])
 const events: string[] = []
 const key: any = { toString(): string { events.push("key"); return "computed" } }
 const computed: any = { [key]: class { static observed = this.name; static { events.push(this.name) } }, x: (() => { events.push("do"); return 2 })() }
 out.push([computed.computed.name, computed.computed.observed], events)
 const symbol = Symbol("slot")
 const symbolic = { [symbol]: class { static observed = this.name }, x: (() => { return 2 })() }
 out.push([symbolic[symbol].name, symbolic[symbol].observed])
 const proto = { __proto__: (): number => 1, x: (() => { return 2 })() }
 out.push(Object.getPrototypeOf(proto).name)
 const named = (() => { return (function written(): number { return 1 }) })()
 const Named = (() => { return (class Written { static observed = this.name }) })()
 const bound = (() => { const source = (): number => 1; return source })()
 out.push(named.name, [Named.name, Named.observed], bound.name)
 const typed = [(function (): number { return 1 }) as (() => number), (() => { return 2 })()] as const
 out.push(typed[0].name)
 const branch = (() => { if (true) { return (): number => 1 } else { return (function (): number { return 2 }) } })()
 out.push(branch.name)
 function parameter(value = (() => { return (class { static observed = this.name }) })()): string[] { return [value.name, value.observed] }
 out.push(parameter())
 const nested = (() => { return (() => { return ((() => { return (class { static observed = this.name }) })()) })() })()
 out.push([nested.name, nested.observed])
 const conditional = true ? (() => 1) : (() => { return () => 2 })()
 const conditionalClass = true ? (class { static observed = this.name }) : (() => { return class { static observed = this.name } })()
 // @ts-ignore -- native always-truthy warning is independent of value naming.
 const logical = (() => 3) || (() => { return () => 4 })()
 // @ts-ignore -- native nullishness warning is independent of value naming.
 const coalescing = (() => 5) ?? (() => { return () => 6 })()
 const method = (class { static observed = this.name; static take(_n: number): string[] { return [this.name, this.observed] } }).take((() => { return 1 })())
 const keyObject = { [(class { static [Symbol.toPrimitive](): string { return this.name } }) as any]: (() => { return 1 })() }
 out.push(conditional.name, [conditionalClass.name, conditionalClass.observed], logical.name, coalescing.name, method, Object.keys(keyObject))
 const matchFunction = ((value: () => number) => value.name)(() => 7)
 const matchClass = ((value: { name: string; observed: string }) => [value.name, value.observed])(class { static observed = this.name })
 out.push(matchFunction, matchClass)
 const pipeArrow = ((value: () => number) => [value.name, value.name])(() => 1)
 const pipeClass = ((value: { name: string; observed: string }) => [value.name, value.observed])(class { static observed = this.name })
 const pipeNamed = ((value: { name: string; observed: string }) => [value.name, value.observed])(class Written { static observed = this.name })
 out.push(pipeArrow, pipeClass, pipeNamed)
 return out
}
