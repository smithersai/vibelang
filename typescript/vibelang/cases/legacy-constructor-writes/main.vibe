export function f(): number { return 1 }
function g(): number { return 2 }
f.constructor = g;
f["constructor"] = g;
({ value: f.constructor } = { value: g });
for (f.constructor of [g]) {}
(f.constructor as Function) = g;
(f.constructor!) = g;
(f.constructor satisfies Function) = g;
delete f.constructor;
delete ((f["constructor"]));
export const result = f()
