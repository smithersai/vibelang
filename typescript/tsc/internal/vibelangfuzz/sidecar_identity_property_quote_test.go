package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSidecarIdentityPropertyQuoted(t *testing.T) {
	const quote = "A non-relative specifier that TypeScript resolves to `x.d.vibe.ts` or `x.d.vibex.ts`, through a package `types` export, a `paths` entry or package `#imports`, resolves to the available `x.vibe` or `x.vibex` source when the final resolved path is outside `node_modules`."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}
