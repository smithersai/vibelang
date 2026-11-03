// VIP-27: inferred library types keep their module identity beside local names.
import { Schema as Codec } from "effect"
export const SchemaAST = "local"
export const decode = Codec.decodeUnknownSync(Codec.String)
export const encode = Codec.encodeSync(Codec.Struct({ value: Codec.Number }))
