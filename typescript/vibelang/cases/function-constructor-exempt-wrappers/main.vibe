export const checks = [
  (() => 1) instanceof ((Function)),
  (() => 1) instanceof (Function as FunctionConstructor),
  (() => 1) instanceof (Function satisfies FunctionConstructor),
  (() => 1) instanceof Function!,
  ((Function)).prototype === (Function as FunctionConstructor).prototype,
  (Function satisfies FunctionConstructor)["prototype"] === Function!?.prototype,
]
