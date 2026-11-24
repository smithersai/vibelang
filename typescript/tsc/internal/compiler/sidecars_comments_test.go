package compiler

import (
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"strings"
	"testing"
)

func TestSidecarCommentLookingLiteralTypes(t *testing.T) {
	for _, literal := range []string{
		"`head\n/// <reference path=\"./payload.d.ts\" />\n\x24{string}\nend`",
		"`head\n//# sourceMappingURL=payload\n\x24{string}\nend`",
		"`head\n//# sourceMappingURL=payload\nend`",
		"`head\n\x24{string}\n/// <reference path='./payload.d.ts' />\nend`",
		"\"head\\\n//# sourceMappingURL=payload\\\nend\"",
	} {
		text := "export type T = " + literal + ";\n"
		got := relocatedSidecarText(text, "/out/main.d.ts", "/src", func(specifier string) string {
			t.Fatalf("literal type reached module resolution: %q", specifier)
			return ""
		}, tspath.CaseSensitive)
		if got != text {
			t.Errorf("got %q, want %q", got, text)
		}
	}
}
func TestSidecarOnlyActualDirectiveCommentsMove(t *testing.T) {
	text := "/// <reference path=\"./payload.d.ts\" />\n/*\n/// <reference path=\"./keep.d.ts\" />\n//# sourceMappingURL=keep\n*/\nexport type T = string;\n//# sourceMappingURL=main.d.ts.map\n"
	want := strings.Replace(text, "./payload.d.ts", "../out/payload.d.ts", 1)
	want = strings.TrimSuffix(want, "//# sourceMappingURL=main.d.ts.map\n")
	got := relocatedSidecarText(text, "/out/main.d.ts", "/src", func(string) string { return "" }, tspath.CaseSensitive)
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
