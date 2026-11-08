package vibelangfuzz

import (
	"testing"
)

const inferSlotCommentQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestVIP3InferSlotMigrationOrderQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", inferSlotCommentQuote)
	chapterSays(t, "007-tooling.md", legacyEffectAliasQuote)
	annotationTwinChapters(t)
}
