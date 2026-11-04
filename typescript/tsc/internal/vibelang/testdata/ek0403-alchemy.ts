// Alchemy Diff.ts excerpts, SHA ba712766dc3605205a711fa8c192c022897d02fa6de2a2254eca9fd8d73cf268.
// Proxy ruling 2026-11-04: these exact bodies must never receive a never tag.
// Unrelated dependencies are signatures; runtime coverage uses the minimized inbox witness.
type Input<T> = T | { readonly deferred: () => T };
declare function isPrimitive(value: unknown): boolean;
declare function isPlainData(value: unknown): value is object;
declare const Output: { isExpr(value: unknown): boolean; hasOutputs(value: unknown): boolean };
declare const Effect: { isEffect(value: unknown): boolean };
declare function stripUnresolved<T>(value: T): T;
declare function canonicalize(value: unknown, stripNullish: boolean): unknown;

export const isResolved = <T>(value: Input<T>): value is T => !_hasUnresolved(value);

const _hasUnresolved = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (value == null || isPrimitive(value)) return false;
  if (Output.isExpr(value) || Effect.isEffect(value)) return true;
  // Only plain data is traversed; any other class instance (Layer, Context,
  // Date, SDK objects) is a resolved leaf — see isPlainData (#1082).
  if (isPlainData(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some((v) => _hasUnresolved(v, seen));
  }
  return false;
};

export const havePropsChanged = <Props extends object>(
  oldProps: Props | undefined,
  newProps: Props,
) =>
  Output.hasOutputs(newProps) ||
  // Compare both sides through `stripUnresolved` so the comparison is
  // symmetric with the commit boundary: persisted props can never hold an
  // Effect or Output expr (stripped at commit / silently dropped by JSON
  // serialization), while desired props may still carry them — e.g. a tagged
  // Worker class in `env` serializes via its `toJSON` to
  // `{"_id":"Effect",...}` and would otherwise report a phantom change on
  // every plan, forever (#874). Unresolved Outputs in `newProps` are already
  // caught by the `hasOutputs` guard above, so stripping here never hides a
  // real difference.
  JSON.stringify(canonicalize(stripUnresolved(oldProps ?? {}), false)) !==
    JSON.stringify(canonicalize(stripUnresolved(newProps ?? {}), false));

