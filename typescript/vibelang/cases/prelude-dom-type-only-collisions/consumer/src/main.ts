import * as NativeKey from "effect/crypto/KeyFormat"
import * as NativeTransfer from "effect/workers/Transferable"
import { format, collector, key, type HostKey, type HostTransfer, type PublicFormat, type Collector } from "../../out/main.js"
const nativeFormat: typeof NativeKey.pem = format
const nativeCollector: typeof NativeTransfer.Collector = collector
const roundtripFormat: typeof format = NativeKey.pem
const roundtripCollector: typeof collector = NativeTransfer.Collector
const hostKey: HostKey = "raw"
const bytes = new ArrayBuffer(0)
const hostTransfer: HostTransfer = bytes
const nativeShape: PublicFormat = NativeKey.spki
const declarationShape: NativeKey.Format<"public", "decode", Uint8Array> = nativeShape
const classType: Collector | undefined = undefined as NativeTransfer.Collector | undefined
void [roundtripFormat, roundtripCollector, declarationShape, classType, hostKey, hostTransfer]
export const result = [nativeFormat === NativeKey.pem, nativeCollector === NativeTransfer.Collector, key, bytes.byteLength]
