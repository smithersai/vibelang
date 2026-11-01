import { makeKeyedQueryMessage } from './keyedQuery.ts'

export const wrap = <A>(data: A) => makeKeyedQueryMessage(data)
