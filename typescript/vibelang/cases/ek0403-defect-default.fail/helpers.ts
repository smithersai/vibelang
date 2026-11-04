// Minimized witness from alchemy's foreign-predicate report.
export type Input<T> = T | { readonly deferred: () => T };
export const isResolved = <T>(v:Input<T>):v is T => !hasUnresolved(v);
const hasUnresolved=(v:unknown):boolean => v!==null && typeof v==="object" && ("deferred" in v || Object.values(v).some(hasUnresolved));
export const havePropsChanged=(a:object,b:object)=>JSON.stringify(a)!==JSON.stringify(b);
