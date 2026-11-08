package vibelangfuzz

import (
	"strings"
	"testing"
)

const serviceReadonlyWholeShapeQuote = "This form adds no shape helper and no namespace"

func TestServiceReadonlyConversionQuoted(t *testing.T) {
	serviceReadonlyConversionQuoted(t)
}

func serviceReadonlyConversionQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("005-services.md"), serviceReadonlyWholeShapeQuote) {
		t.Fatalf("005-services.md no longer says %q", serviceReadonlyWholeShapeQuote)
	}
}
