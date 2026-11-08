import { Effect } from "effect"
import { changedMaps, changeMaps } from "./native-map.js"

export function main() {
  return Effect.sync(() => {
    const reuse = changedMaps(() => {
      const [first, ...tail] = [1, 2]
      changeMaps()
      return [first, tail]
    })
    const close = changedMaps(() => { changeMaps(); return 7 })
    const create = changedMaps(() => {
      const [first, ...tail] = [1, 2]
      return [first, tail]
    }, true)
    return [reuse, close, create]
  })
}
