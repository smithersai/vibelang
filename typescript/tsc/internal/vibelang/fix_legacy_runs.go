package vibelang

// Before VIP-1, a call in effect code whose result was an Effect ran where it
// stood, with or without try: as a statement, an initializer, a return value,
// an arm of ?: or match, either side of ?? or ||, the right side of &&, a do
// expression's result, an effect arrow's expression body, a catch
// expression's fallback or handler, an argument, an element or a property
// value. VIP-1 runs it only after try, so the call now gives its program,
// often with no more than EK4802, and the VIP-1 migration (--fix-vip-only)
// writes try there. A legacy migration preserves the old call's run phase,
// and ambiguous source is not reinterpreted: the migration uses its known
// pre-migration model, or refuses (decided detail 274).
//
// legacyRunOf is that model. It reads only what the old rule read: where
// the call stands and whether its result is an Effect (D24: a Config, an Exit
// or an error instance is data; D270: a union of Effects is one). The old
// compiler held a call it passed by name (D147), held in a declared const or
// field (D262, D265, D269), or that a catch, fork, try or an await operation
// runs, and gave an unmarked function's concise body as that function's
// program. Where it decided by more than the call and its position, as by
// inferring an unmarked function's form or passing a whole expression by
// name, legacyRunOf answers legacyUnknown with the reason, and the pass
// reports the site instead of guessing.

const ()
