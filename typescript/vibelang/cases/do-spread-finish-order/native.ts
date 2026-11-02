// Native IIFE twin: executed directly by Node, without VibeLang lowering.

import { Box, iter, key, shape, src, str, sum, sym, tags, Trace, withArrayIterator } from "./operands.ts"

function s0Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = [...iter(t, 3, -1), (function (): number { t.ev('do'); t.state = 2; return 3 })()]
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s1Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = sum(t, ...iter(t, 2, -1), (function (): number { t.ev('do'); t.state = 2; return 3 })())
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s2Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = new Box(t, ...iter(t, 2, -1), (function (): number { t.ev('do'); t.state = 2; return 3 })())
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s3Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = [...iter(t, 3, 1), (function (): number { t.ev('do'); t.state = 2; return 3 })()]
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s4Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = [...iter(t, 1, -1), 0, ...iter(t, 1, -1), (function (): number { t.ev('do'); t.state = 2; return 3 })(), ...iter(t, 1, -1)]
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s5Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = [, 1, , (function (): number { t.ev('do'); return 3 })()]
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s23Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = [...iter(t, 1, -1), { ...src(t, false), [key(t, 'string')]: `${str(t, false)}${(function (): number { t.ev('do'); return t.fail('do') })()}` }]
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s24Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = withArrayIterator(t, (): unknown => [...[7, 8], (function (): number { t.ev('do'); return 3 })()])
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s25Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = withArrayIterator(t, (): unknown => sum(t, ...[7, 8], (function (): number { t.ev('do'); return 3 })()))
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s26Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = sum(t, ...iter(t, 1, -1), [...iter(t, 1, -1), { ...src(t, false), [key(t, 'string')]: `${str(t, false)}${(function (): number { t.ev('do'); t.state = 2; return 3 })()}` }].length)
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

export function runNative(): [string, unknown][] {
  return [["array-spread", s0Fn()],["call-spread", s1Fn()],["new-spread", s2Fn()],["spread-throws", s3Fn()],["two-spreads", s4Fn()],["elision", s5Fn()],["do-throws", s23Fn()],["array-iterator", s24Fn()],["call-array-iterator", s25Fn()],["nested", s26Fn()]]
}
