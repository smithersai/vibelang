import { E, S } from "./main.js"
export const e: E = new E({ id: 1 })
export const s: S = new S({ name: "ok" })
type Assert<T extends true> = T
type NoExtraE = Assert<Exclude<keyof typeof E, keyof typeof import("./twin.js").E> extends never ? true : false>
type NoExtraS = Assert<Exclude<keyof typeof S, keyof typeof import("./twin.js").S> extends never ? true : false>
