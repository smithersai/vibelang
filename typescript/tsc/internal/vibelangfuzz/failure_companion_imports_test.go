package vibelangfuzz

import "testing"

func TestFailureCompanionImportsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "Module resolution is as in TypeScript, with `.vibe` and `.vibex` beside `.ts` and `.tsx`: NodeNext `./user.js` can resolve to `user.vibe`.")
}
