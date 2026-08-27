/** @module @throws {never} */
export { config } from "./miscased-relay-target.ts";

// A properly marked relay whose OWN initialization is trustworthy and whose
// re-export loads a module that is not. The marker on line 1 is the exact
// documented spelling, so nothing about this file is a near miss: the near
// miss is one edge further out, in miscased-relay-target.ts.
//
// A re-export is a static initialization edge. Evaluating this module
// evaluates ./miscased-relay-target.ts first, so a compiler that stops asking
// after depth one has certified an initializer it never inspected.
