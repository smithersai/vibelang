// The experimental Crypto (D313): one WebCrypto implementation, so every
// platform's layer is this one, merged with that platform's Effect crypto
// services.
import * as Crypto from "../Crypto.js"

/** Provides the experimental Crypto from the platform's WebCrypto. */
export const layer = Crypto.layerWebCrypto
