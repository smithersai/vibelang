/**
 * Lenient base64 decoding where Effect's strict Base64 / Base64Url decoders
 * cannot replace Node's Buffer decoder. Pure computation; no service or layer.
 * @experimental
 * @since 0.0.12
 */
import * as Result from "effect/Result"
import { Base64, EncodingError } from "effect/encoding"

/**
 * Decodes with Buffer.from(input, "base64") semantics: either alphabet,
 * ignored non-alphabet characters, optional padding, stop at the first "=",
 * and discard a final lone sextet. Node reads the low byte of UTF-16 code
 * units; preserving that detail also covers non-ASCII input.
 *
 * Failures contain no input: callers may be decoding private key material.
 * @throws never
 * @since 0.0.12
 */
export const decodeBase64Lenient = (input: string): Result.Result<Uint8Array, EncodingError.EncodingError> => {
  let normalized = ""
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i) & 255
    if (code === 61) break
    if (code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47) {
      normalized += String.fromCharCode(code)
    } else if (code === 45) normalized += "+"
    else if (code === 95) normalized += "/"
  }
  if (normalized.length % 4 === 1) normalized = normalized.slice(0, -1)
  normalized += "=".repeat((4 - normalized.length % 4) % 4)
  return Result.mapError(Base64.decode(normalized), () => new EncodingError.EncodingError({
    module: "Base64",
    kind: "Decode",
    input: "<redacted>",
    message: "Could not decode lenient base64"
  }))
}
