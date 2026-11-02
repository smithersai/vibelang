// Native IIFE twin: executed directly by Node, without VibeLang lowering.

import { Box, iter, key, shape, src, str, sum, sym, tags, Trace, withArrayIterator } from "./operands.ts"

function s20Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = tags(t).tag`a${(function (): number { t.ev('do'); t.state = 2; return 3 })()}`
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s21Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = tags(t)['tag']`a${str(t, false)}${(function (): number { t.ev('do'); t.state = 2; return 3 })()}`
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

function s22Fn(): unknown {
  const t = new Trace()
  try {
    const value: unknown = [0, 1].map((i: number): string => tags(t).tag`x${(function (): number { t.ev('do:' + i); return i })()}`).concat([String(t.seen[0] === t.seen[1])])
    return [t.events, shape(value)]
  } catch (e) {
    return [t.events, "throw:" + (e instanceof Error ? e.message : String(e))]
  }
}

export function runNative(): [string, unknown][] {
  return [["tag-getter", s20Fn()],["tag-element", s21Fn()],["tag-identity", s22Fn()]]
}
