package vibelangfuzz

// Match.instanceOf is a native instanceof predicate. This generator extends
// FuzzFix's existing before/after Exit oracle, rather than adding an oracle
// derived from today's matcher. The tooling chapter requires preserved tests
// and results (matchInstanceOfRule); 004-match's class patterns deliberately
// broaden Array and the primitive constructors. Both primitive and boxed
// subjects are present for every constructor, with fuzzed literal values.
var matchInstanceOfKeys = []string{"number", "string", "boolean", "array", "class", "alias", "custom", "external", "escape", "subclass"}
