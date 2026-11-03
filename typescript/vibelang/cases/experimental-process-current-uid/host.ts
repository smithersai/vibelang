import * as host from "node:process"
export const nativeUid = (): number | undefined => host.getuid?.()
