package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const platformWrapperInputsQuote = "Explicit `sync` inputs stay evaluated at the original call site, in order; the callback still runs only when its Effect runs."

func TestPlatformWrapperInputsQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), platformWrapperInputsQuote) {
		t.Fatalf("missing spec quote %q", platformWrapperInputsQuote)
	}
}

var platformWrapperInputBodies = map[string]string{
	"restore":    "if (value === undefined) delete process.env.COMPLETE; else process.env.COMPLETE = value",
	"write":      "process.env.COMPLETE = value",
	"delete":     "delete process.env.COMPLETE",
	"two-writes": "process.env.COMPLETE = value; process.env.SECOND = value",
}
