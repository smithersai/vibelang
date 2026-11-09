// Private specialization shared by the loaders, never a public project option.
export const loaderScope = Symbol("loader scope")
// Private to register.mjs: called when a loader compile finds no cached result.
export const loaderMiss = Symbol("loader miss")
