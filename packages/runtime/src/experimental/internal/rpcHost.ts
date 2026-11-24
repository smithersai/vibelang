// VIP-57: what every platform's worker host shares. A module handle names a
// compiled worker module; the host spawns the runtime's generic entry for it
// and passes the module's URL, which the entry imports.

/** The `workerData` key, and the entry URL's search parameter, that carry the module URL. */
export const moduleParameter = "vibelang-module"

/** The generic entry's URL with the module URL in its search parameters, for browsers, which have no `workerData`. */
export const entryWithModule = (entry: URL, module: URL): URL => {
  const url = new URL(entry.href)
  url.searchParams.set(moduleParameter, module.href)
  return url
}

/** The module URL from the generic entry's own URL. */
export const moduleFromEntry = (entry: string): string | undefined =>
  new URL(entry).searchParams.get(moduleParameter) ?? undefined

/** The default export of a worker module, or a clear error. */
export const defaultLayer = (module: string, exports: any): unknown => {
  const layer = exports?.default
  if (layer === undefined) throw new Error(`Experimental.Rpc: worker module ${module} has no default export; export default the Layer that provides its schema services`)
  return layer
}
