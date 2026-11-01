// foldkit-92: keyedQuery.d.ts named import("../../schema/index.js") once
// schema/index was migrated; its baseline says index.ts.
import { makeMessage } from '../schema/index.ts'
import { retries } from './retries.ts'

export const makeKeyedQueryMessage = <A>(data: A) => makeMessage({ data, retries })
