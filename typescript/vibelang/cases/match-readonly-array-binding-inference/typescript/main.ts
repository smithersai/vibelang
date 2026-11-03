export function value<T>(s: readonly T[], fallback: T) {
 const it = s[Symbol.iterator](); const v = it.next();
 return !v.done && it.next().done ? v.value : fallback;
}
export function second<T>(s: readonly [string, T], fallback: T) {
 return s[1];
}
export function nested<T>(s: readonly (readonly T[])[], fallback: T) {
 const outer = s[Symbol.iterator]().next(); if (outer.done) return fallback;
 const inner = outer.value[Symbol.iterator]().next();
 return inner.done ? fallback : inner.value;
}
export function tail<T>(s: readonly T[], fallback: T[]) {
 return s.length ? s.slice(1) : fallback;
}
export function nullable<T>(s: readonly T[] | null, fallback: T) {
 if (s === null) return fallback;
 const v = s[Symbol.iterator]().next();
 return v.done ? fallback : v.value;
}
export function payload(s: readonly (number | undefined)[]) {
 const v = s[Symbol.iterator]().next(); return v.done ? 0 : v.value;
}
export function nativeBrand<T>(s: readonly T[]) {
 if (Array.isArray(s)) return s[0];
 return 0;
}
