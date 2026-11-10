package vibelangfmt

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestJSDocInteriorRestoration(t *testing.T) {
	for _, raw := range []string{
		"/*\n *\n * paragraph\n */",
		"/**\n * First.\n *\n *\n * Last.\n *\n */",
		"/**\n * ```ts\n *   const n = 1\n * ```\n *\n */",
		"/**\n   * irregular spacing\n\n   * @param value    text\n   */",
		"/** @internal */",
		"/***/",
		"/**/",
	} {
		t.Run(raw, func(t *testing.T) {
			source := "function f() {\n" + raw + "\nconst value = 1\n}"
			got, err := formatWithComments(source, core.ScriptKindTS, func(text string) (string, error) {
				// The host lays out the containing scope, never the saved interior.
				return strings.ReplaceAll(text, "\n", "\n  "), nil
			})
			if err != nil {
				t.Fatal(err)
			}
			want := strings.ReplaceAll(raw, "\n", "\n  ")
			if !strings.Contains(got, want) {
				t.Fatalf("comment changed:\n%s\nwant:\n%s", got, want)
			}
		})
	}
}

func TestJSDocRestorationRejectsLostComment(t *testing.T) {
	_, err := formatWithComments("/** documentation */ const n = 1", core.ScriptKindTS, func(string) (string, error) {
		return "const n = 1", nil
	})
	if err == nil || !strings.Contains(err.Error(), "lost a documentation comment") {
		t.Fatalf("lost comment accepted: %v", err)
	}
}

func TestJSDocLexicalContext(t *testing.T) {
	for _, source := range []string{
		"const r = /[/**]/; /** actual */ const n = 1",
		"const s = `head ${1} /** text */ ${2} tail`; /** actual */ const n = 1",
		"const s = <div>/** text */{1}/** tail */</div>; /** actual */ const n = 1",
		"const s = '/** text */'; // /** line text */\n/** actual */ const n = 1",
	} {
		kind := core.ScriptKindTS
		if strings.Contains(source, "<div>") {
			kind = core.ScriptKindTSX
		}
		ranges := blockCommentRanges(source, kind)
		if len(ranges) != 1 || source[ranges[0].Pos():ranges[0].End()] != "/** actual */" {
			t.Fatalf("wrong comment ranges for %q: %v", source, ranges)
		}
	}
}
