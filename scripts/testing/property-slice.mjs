// Slice the generated sample sequence, preserving its seed, size and shrinker.
export function propertySlice(env = process.env) {
  const value = env.VIBELANG_PROPERTY_SLICE
  if (value === undefined || value === "") return { index: 0, count: 1 }
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(value)
  const index = Number(match?.[1]) - 1, count = Number(match?.[2])
  if (!match || !Number.isSafeInteger(count) || count > 1024 || index >= count)
    throw new Error("VIBELANG_PROPERTY_SLICE must be i/n with 1 <= i <= n <= 1024")
  return { index, count }
}

export function slicedCheck(check, slice) {
  let at = 0, shrinking = false
  return async (...input) => {
    if (!shrinking && at++ % slice.count !== slice.index) return
    try {
      const result = await check(...input)
      if (result === false) shrinking = true
      return result
    } catch (error) { shrinking = true; throw error }
  }
}

// Delegate the public fast-check property protocol, retaining synchronous and
// asynchronous predicates, examples, generation, hooks and the original shrinker.
export function sliceFastCheckProperty(property, slice) {
  if (slice.count === 1) return property
  let at = 0, shrinking = false
  const observe = result => { if (result !== null) shrinking = true; return result }
  return new Proxy(property, {
    get(target, key) {
      if (key === "run") return (...args) => {
        if (!shrinking && at++ % slice.count !== slice.index)
          return target.isAsync() ? Promise.resolve(null) : null
        const result = target.run(...args)
        return target.isAsync() ? result.then(observe) : observe(result)
      }
      const value = Reflect.get(target, key)
      return typeof value === "function" ? value.bind(target) : value
    }
  })
}

export function assertPropertySlice(fc, property, options, env = process.env) {
  const slice = propertySlice(env)
  if (slice.count > 1 && options?.seed === undefined)
    throw new Error("a property slice requires its original seed")
  return fc.assert(sliceFastCheckProperty(property, slice), options)
}
