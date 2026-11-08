package vibelangfuzz

import (
	"testing"
)

const plainReturnedInferTarget = "FuzzPlainReturnedEffectInference"
const plainReturnedInferQuote = "writes checker-proved inferred channel types, preserving declaration types and runtime behavior, or refuses with an explanation if it cannot name those types safely."

func TestPlainReturnedEffectInferenceQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", plainReturnedInferQuote)
}
