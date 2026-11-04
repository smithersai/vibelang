package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const dataAssertionFixQuote = "Quick fixes and codemods use the formatter to preserve the parse under Appendix A."

func TestDataGenericAssertionFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), dataAssertionFixQuote) {
		t.Fatalf("stale migration oracle: %q", dataAssertionFixQuote)
	}
	if !strings.Contains(SpecText("900-appendices.md"), declarationContextQuote) {
		t.Fatalf("stale declaration oracle: %q", declarationContextQuote)
	}
}

func FuzzDataGenericAssertionFix(f *testing.F) {
	startShortBudget(f)
	keys := []string{"as-lf", "as-crlf", "as-comment", "satisfies-lf", "satisfies-crlf", "satisfies-comment"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		TestDataGenericAssertionFixQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		operator, gapKey, ok := strings.Cut(key, "-")
		if !ok || operator != "as" && operator != "satisfies" {
			return
		}
		gap := "\n"
		switch gapKey {
		case "lf":
		case "crlf":
			gap = "\r\n"
		case "comment":
			gap = " /* keep\n*/ "
		default:
			return
		}
		if mutation&1 != 0 {
			gap = "// keep\n"
		}
		n := fmt.Sprint(int(mutation) % 17)
		expression := "data " + operator + gap + "<T>(value:T)=>T"
		if mutation&2 != 0 {
			expression += " as unknown"
		}
		head := "const data = <T>(value:T)=>value;\n"
		if mutation&8 != 0 {
			head = "/* café 😀 */\n" + head
		}
		tail := ";\nexport const result:number = data(" + n + ")\n"
		source := head + expression + tail
		before := toolsCompile(t, w, "FuzzDataGenericAssertionFix", map[string]string{"main.vibe": source})
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: mutation&4 != 0})
		if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 1 {
			Gap(t, "FuzzDataGenericAssertionFix", "apply:"+key, "Appendix A: %s; %s; no preserving repair: %+v", declarationContextQuote, dataAssertionFixQuote, result)
		}
		var fixed string
		for _, file := range result.Files {
			fixed = file.Text
		}
		if want := head + "(" + expression + ")" + tail; fixed != want {
			Gap(t, "FuzzDataGenericAssertionFix", "text:"+key, "parentheses must retain every original token/comment: got %q want %q", fixed, want)
		}
		after := toolsCompile(t, w, "FuzzDataGenericAssertionFix", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if HasError(after.Diagnostics) {
			Gap(t, "FuzzDataGenericAssertionFix", "compile:"+key, "repaired expression rejected: %v", after.Diagnostics)
		}
		twin := toolsCompile(t, w, "FuzzDataGenericAssertionFix", map[string]string{"main.ts": source})
		defer twin.Remove()
		if HasError(twin.Diagnostics) || after.Outputs["out/main.d.ts"] != twin.Outputs["out/main.d.ts"] {
			Gap(t, "FuzzDataGenericAssertionFix", "api:"+key, "repair must retain TypeScript public declarations: %v", twin.Diagnostics)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Refused) != 0 || len(again.Files) != 0 {
			Gap(t, "FuzzDataGenericAssertionFix", "idempotent:"+key, "repair is not idempotent: %+v", again)
		}
	})
}
