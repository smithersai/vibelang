const f = () => 1
export const values = [
 f instanceof (globalThis.Function as FunctionConstructor),
 f instanceof (<FunctionConstructor>globalThis.Function),
 f instanceof (globalThis.Function satisfies FunctionConstructor),
 f instanceof globalThis.Function!,
 (globalThis.Function as FunctionConstructor).prototype === Function.prototype,
 (<FunctionConstructor>globalThis.Function).prototype === Function.prototype,
 (globalThis.Function satisfies FunctionConstructor).prototype === Function.prototype,
 globalThis.Function!.prototype === Function.prototype,
]
