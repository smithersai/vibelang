// Native IIFE twin: executed directly by Node, without VibeLang lowering.

import { Box, iter, key, shape, src, str, sum, sym, tags, Trace, withArrayIterator } from "./operands.ts"

function s17Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = `a${str(t, false)}b${(function (): number { t.ev('do'); t.state = 2; return 3 })()}`
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s18Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = `a${str(t, true)}b${(function (): number { t.ev('do'); return 3 })()}`
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s19Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = `a${sym as unknown as string}b${(function (): number { t.ev('do'); return 3 })()}`
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

export function runNative(): [string, unknown][] {
  return [["template", s17Fn()],["template-throws", s18Fn()],["template-symbol", s19Fn()]]
}
