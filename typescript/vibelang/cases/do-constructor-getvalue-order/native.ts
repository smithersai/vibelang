// Native IIFE twin: executed directly by Node, without VibeLang lowering.

import { Trace, constructors, key, replacement } from "./operands.ts"

function s0Fn(): unknown {
  const t = new Trace()
  try {
    const obj = constructors(t)
    const result = new obj.C((function (): number { t.ev("do"); t.state = 2; return 3 })())
    return [t.events, result]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s1Fn(): unknown {
  const t = new Trace()
  try {
    const obj = constructors(t)
    const result = new obj[key(t)]((function (): number { t.ev("do"); t.state = 2; return 3 })())
    return [t.events, result]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s2Fn(): unknown {
  const t = new Trace()
  try {
    const obj = replacement(t)
    const result = new obj.C((function (): number { t.ev("do"); t.state = 2; obj.C = obj.B; return 3 })())
    return [t.events, result]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s3Fn(): unknown {
  const t = new Trace()
  try {
    const obj = constructors(t, true)
    const result = new obj.C((function (): number { t.ev("do"); t.state = 2; return 3 })())
    return [t.events, result]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

export function runNative(): [string, unknown][] {
  return [["property", s0Fn()],["element", s1Fn()],["replacement", s2Fn()],["getter-throws", s3Fn()]]
}
