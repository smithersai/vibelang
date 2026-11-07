// Which projected files a declaration snapshot side owns.

/**
 * Whether file belongs to the side whose projected package directory is base.
 * A projection (apiProjection) mirrors the package's ancestors inside one
 * temporary directory, so a declaration for a source above the package lies
 * outside base and is still that side's own. Installed packages are not.
 */
export function ownsFile(base, file) {
  if (file === base || file.startsWith(base + "/")) return true
  const scope = /^(.*\/migrate-api-projection-[^/]+)\/level-0(?:\/level-\d+)*$/.exec(base)?.[1]
  return scope !== undefined && file.startsWith(scope + "/") && !file.slice(scope.length).includes("/node_modules/")
}
