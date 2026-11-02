// Native IIFE twin: executed directly by Node, without VibeLang lowering.

import { Box, iter, key, shape, src, str, sum, sym, tags, Trace, withArrayIterator } from "./operands.ts"

function s10Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ [key(t, 'string')]: (function (): number { t.ev('do'); t.state = 2; return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s11Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ [key(t, 'string')]: (t.ev('value:' + t.state), 1), b: (function (): number { t.ev('do'); t.state = 2; return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s12Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ [key(t, 'symbol')]: (function (): number { t.ev('do'); return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s13Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ [key(t, 'throw')]: (function (): number { t.ev('do'); return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s14Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ k1: 0, [key(t, 'string')]: (function (): number { t.ev('do'); return 3 })(), z: 9 })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s15Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ name: 'self', run(t: Trace): unknown { return { [key(t, 'string')]: this, b: (function (): number { t.ev('do'); return 3 })() } } }).run(t)
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s16Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = ({ [key(t, 'string')](): number { return 1 }, get [key(t, 'string')](): number { return 2 }, b: (function (): number { t.ev('do'); t.state = 2; return 3 })() })
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s90Fn(): unknown {
  const t = new Trace()
  try {
    const record: Record<string, unknown> = {}
    record[key(t, 'string')] = (function (): number { t.ev('do'); t.state = 2; return 3 })()
    return [t.events, shape(record)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s91Fn(): unknown {
  const t = new Trace()
  try {
    const record: Record<string, unknown> = {}
    record[key(t, 'throw')] = (function (): number { t.ev('do'); t.state = 2; return 3 })()
    return [t.events, shape(record)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

export function runNative(): [string, unknown][] {
  return [["assignment-key-late", s90Fn()],["assignment-key-throws-late", s91Fn()],["computed-key", s10Fn()],["computed-key-later", s11Fn()],["computed-key-symbol", s12Fn()],["computed-key-throws", s13Fn()],["computed-key-overwrite", s14Fn()],["computed-key-this", s15Fn()],["method-key", s16Fn()]]
}
