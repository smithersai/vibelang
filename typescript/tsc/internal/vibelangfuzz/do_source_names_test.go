package vibelangfuzz

import "testing"

func TestDoSourceNamesQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "Generated captures preserve the source [NamedEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-namedevaluation) context.")
	chapterSays(t, "001-functions.md", "The naming context must be preserved or suppressed before creation, rather than repairing `.name` afterward: a class static initializer may already have observed it.")
}
