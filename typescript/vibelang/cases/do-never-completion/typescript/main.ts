import { stop, raise } from "./stop.js"
export function d1(): unknown { try { return (() => { raise(); return 1 })() } catch (error) { return error } }
export function d2(): unknown { return (() => { stop(); return 1 })() }
export function d3(): unknown { try { return (() => { stop(); return 1 })() } catch (error) { return error } }
export function d4(): number { return (() => { return 1 })() }
export function d5(): number { return (() => { stop(); return 1 })() }
export function d6(flag: boolean): number { return (() => { if (flag) stop(); return 1 })() }

export function outerReceiver(): string {
  stop();
  return (class { static m(n: number): string { return String(n) } }).m((() => { return 1 })());
}
export function outerValue(): string {
  stop();
  const value = (() => { return 1 })();
  return value.toFixed();
}
export function afterReturn(): string {
  return "before";
  const value = (() => { return 1 })();
  return value.toFixed();
}

export function outerEnd(): number {
  stop();
  const value = (() => { return 1 })();
  value.toFixed();
}
export function returnEnd(): number {
  return 1;
  const value = (() => { return 1 })();
  value.toFixed();
}

export function afterReturnBinding(): unknown {
 return 1;
 let user;
 const value = (() => { return 1 })();
 return user;
}
export function afterReturnLabel(): number {
 return 1;
 const value = (() => { return 1 })();
 unused: {}
 void value;
}
export function inferredReturn() {
 return 1;
 const value = (() => { return 1 })();
 void value;
}
export const checkedInferred: number = inferredReturn();

// The IIFE twin must expose the same public declarations.
export const ClassValue = (() => { return (class { value = 1; method() { return this.value } }) })();
export const NamedClassValue: { new(): { value: number }; Self: unknown } = (() => { return (class Source { static Self = Source; value = 1 }) })();
export function callbackValue() { return (() => { return (() => 1) })(); }
export const nestedClassValue: { new(): object; Self: unknown } = (() => { const inner = (() => { return (class Inner { static Self = Inner }) })(); return inner })();
export const finallyClassValue = (() => { try { return (class { value = 1 }) } finally {} })();

// Empty array receiver captures keep the source literal's checked type.
export function emptyReceiver() { return [].concat((() => { return [] })()) }
export function emptyOptionalReceiver() { return []?.concat((() => { return [] })()) }
export function emptyComputedReceiver() { return []["concat"]((() => { return [] })()) }
export function filledReceiver() { const values = []; values.push(1); return values.concat((() => { return [] })()) }

export function emptyMatch(): number { return ((values: readonly unknown[]) => values.length === 0 ? 1 : 0)([]) }
export function emptyLiftedMatch(): number { return ((values: readonly unknown[]) => values.length === 0 ? 1 : 0)([]) }
export function emptyIs(): boolean { return ((values: readonly unknown[]) => values.length === 0)([]) }

export function emptyConditional(flag: boolean) { return flag ? [] : (() => { return [] })() }
export function emptyLogical(flag: boolean) { return flag && (() => { return [] })() }
export function emptyCoalesce(flag: boolean) { return (flag ? [] : undefined) ?? (() => { return [] })() }
export const conditionalLiteral = (flag: boolean): 1 | 2 => flag ? (() : 1 => { return 1 })() : (() : 2 => { return 2 })();
export const logicalLiteral = (flag: boolean): false | 1 => flag && (() : 1 => { return 1 })();
export const coalescedLiteral = (flag: boolean): 1 | 2 => (flag ? 1 : undefined) ?? (() : 2 => { return 2 })();

type Shape = { tag: "a" } | { tag: "b" };
export function contextConditional(flag: boolean): Shape { return flag ? (() : Shape => ({ tag: "a" }))() : (() : Shape => ({ tag: "b" }))() }
export function contextLogical(flag: boolean): false | Shape { return flag && (() : Shape => ({ tag: "a" }))() }
export function contextCoalesce(flag: boolean): Shape { return (flag ? { tag: "a" } : undefined) ?? (() : Shape => ({ tag: "b" }))() }
export function contextOr(flag: boolean): Shape { return (flag ? { tag: "a" } : undefined) || (() : Shape => ({ tag: "b" }))() }
