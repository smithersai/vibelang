// foldkit-92: experimental/query/keyedQuery.ts writes .js specifiers under
// module nodenext and rewriteRelativeImportExtensions. Its baseline declares
// import("../../schema/index.ts"), tsc's own spelling for a module the file
// never imports; once schema/index was .vibe it declared index.js.
import { defineMessageUnion } from '../message/index.js'

const makeKeyedQueryMessage = <A>(data: A) => defineMessageUnion({ data })
export type KeyedQueryMessage<A> = ReturnType<typeof makeKeyedQueryMessage<A>>
export const keyedQueryMessage = <A>(data: A) => makeKeyedQueryMessage(data)
