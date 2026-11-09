package vibelang

import ()

// TypeScript elides an unreferenced internal alias in an external module,
// except under verbatimModuleSyntax. Such an alias neither reads the host at
// runtime nor contributes to a declaration. Keep every source reference,
// including type references, and conservatively refuse comments/escapes rather
// than moving documentation or missing an escaped identifier.
