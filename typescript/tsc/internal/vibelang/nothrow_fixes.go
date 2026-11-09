package vibelang

import ()

// EK0401's quick fixes, in DESIGN.md's order (nothrow, 2026-10-31):
//
//  1. Make the function effect. Its throw becomes Effect.fail; a call known
//     to throw becomes try Effect.try(() => call). A plain return annotation
//     goes, because an effect function's written return type is an Effect
//     (EK0106): the Effect type is inferred.
//
//     function f(x: number): number { if (x < 0) throw new Bad() … }
//     effect function f(x: number) { if (x < 0) throw new Bad() … }
//
//  2. Use die: the same, with the throw statement written return try die(e),
//     which keeps a JavaScript throw's runtime meaning inside an Effect, a
//     defect.
//
// A plain catch handler becomes catch effect (e) => …. Neither fix is
// offered for a constructor, accessor, plain generator, initializer, static
// block, parameter list or the top level, which can't be effect code: their
// fix is moving the code to a .ts file. Nor is it offered where making the
// function effect would change a type something else fixes (FuzzEditor,
// editor:quickfix-error:EK401:TS2394 and TS2416): an overload implementation,
// whose overloads must stay compatible with it, and a method whose name a
// base class, an implemented interface or the object's contextual type
// declares, or a callback whose parameter type wants a value.
