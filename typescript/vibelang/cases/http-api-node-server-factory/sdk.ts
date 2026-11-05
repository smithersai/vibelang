import { Layer } from "effect"
export const events: string[] = []
export function mark(event: string) { events.push(event) }
export function createServer() { events.push("create"); return {} }
export function layer(make: () => object, port: number) {
  events.push("layer:" + port)
  return Layer.suspend(() => { make(); return Layer.empty })
}
