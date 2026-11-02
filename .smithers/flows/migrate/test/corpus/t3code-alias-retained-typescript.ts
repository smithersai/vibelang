import { readAccess, type ReadAccess } from "~/state/filesystem"
import { assetBase } from "~/assets/base"
export function access(): ReadAccess { return readAccess() }
export const base: string = assetBase
