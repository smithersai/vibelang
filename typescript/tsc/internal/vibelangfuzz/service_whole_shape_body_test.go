package vibelangfuzz

import (
	"strings"
	"testing"
)

const serviceWholeShapeBodyQuote = "A recognized service header missing its required body is `EK0906`."

func TestServiceWholeShapeBodyQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceWholeShapeBodyQuote) {
		t.Fatalf("service body rule moved: %q", serviceWholeShapeBodyQuote)
	}
}
