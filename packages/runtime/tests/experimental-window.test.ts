import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { Window } from "vibelang-runtime/experimental"
import { ExperimentalBrowserWindow } from "vibelang-runtime/experimental/platform-browser"

test("Window: current gives the host's window, read each time it runs", async () => {
  const first = new EventTarget() as unknown as globalThis.Window
  const second = new EventTarget() as unknown as globalThis.Window
  let current = first
  const service = Window.make({ window: () => current })
  expect(await Effect.runPromise(service.current)).toBe(first)
  current = second
  expect(await Effect.runPromise(service.current)).toBe(second)
})

test("Window: the browser layer reads the host when a member runs", async () => {
  const host = globalThis as { window?: unknown }
  const original = host.window
  delete host.window
  const current = Effect.flatMap(Effect.service(Window.Window), (window) => window.current)
  try {
    await Effect.runPromise(Effect.provide(Effect.service(Window.Window), ExperimentalBrowserWindow.layer))
    expect(String(await Effect.runPromiseExit(Effect.provide(current, ExperimentalBrowserWindow.layer)))).toContain("needs window")
    const fake = new EventTarget()
    host.window = fake
    expect(await Effect.runPromise(Effect.provide(current, ExperimentalBrowserWindow.layer))).toBe(fake as never)
  } finally {
    if (original === undefined) delete host.window
    else host.window = original
  }
})

test("Window: layerTest gives the fake", async () => {
  const fake = new EventTarget() as unknown as globalThis.Window
  const current = Effect.flatMap(Effect.service(Window.Window), (window) => window.current)
  expect(await Effect.runPromise(Effect.provide(current, Window.layerTest(fake)))).toBe(fake)
})
