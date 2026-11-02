// Native IIFE twin: executed directly by Node, without VibeLang lowering.

import { Box, iter, key, shape, src, str, sum, sym, tags, Trace, withArrayIterator } from "./operands.ts"

function s6Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ ...src(t, false), last: (function (): number { t.ev('do'); t.state = 2; return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s7Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ ...(null as null | { x: number }), last: (function (): number { t.ev('do'); return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s8Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ ...src(t, true), last: (function (): number { t.ev('do'); return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s9Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ x0: 0, ...src(t, false), y0: (function (): number { t.ev('do'); t.state = 2; return 3 })(), ...src(t, false) })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

export function runNative(): [string, unknown][] {
  return [["object-spread", s6Fn()],["object-spread-null", s7Fn()],["object-spread-throws", s8Fn()],["object-spread-order", s9Fn()]]
}
