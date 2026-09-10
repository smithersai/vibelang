/** Host binding of the shared keyed-source/v2 runtime data codec. */
import { types } from "node:util"
import { createKeyedValueCodec } from "./keyed-value-core.ts"
export { KeyedValueError, KEYED_VALUE_LIMITS, type KeyedValue } from "./keyed-value-core.ts"

export const { snapshotKeyedJSON, encodeKeyedValue, decodeKeyedValue, keyedValuePath } = createKeyedValueCodec(types.isProxy)
