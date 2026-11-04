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
		for _, relocated := range []bool{false, true} {
			got := sidecarText(text, "/out/main.d.ts", "/src/main.vibe", func(string) bool { return false }, tspath.CaseSensitive)
			if relocated {
				got = relocatedSidecarText(text, "/out/main.d.ts", "/src", func(s string) string { return "/src/" + s }, tspath.CaseSensitive)
			}
			if got != text {
				t.Errorf("relocated=%v: got %q want %q", relocated, got, text)
			}
		}
	}
}
func TestSidecarOnlyActualDirectiveCommentsMove(t *testing.T) {
	text := "/// <reference path=\"./payload.d.ts\" />\n/*\n/// <reference path=\"./keep.d.ts\" />\n//# sourceMappingURL=keep\n*/\nexport type T = string;\n//# sourceMappingURL=main.d.ts.map\n"
	want := strings.Replace(text, "./payload.d.ts", "../out/payload.d.ts", 1)
	want = strings.TrimSuffix(want, "//# sourceMappingURL=main.d.ts.map\n")
	for _, got := range []string{
		sidecarText(text, "/out/main.d.ts", "/src/main.vibe", func(string) bool { return false }, tspath.CaseSensitive),
		relocatedSidecarText(text, "/out/main.d.ts", "/src", func(s string) string { return s }, tspath.CaseSensitive),
	} {
		if got != want {
			t.Errorf("got %q want %q", got, want)
		}
	}
}
