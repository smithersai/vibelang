package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const errorInheritanceRetirementQuote = "`error` declarations allow no `extends` and no `_tag` override; EK2117 enforces it."

func TestErrorConstructorRetirementQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0013-error-declarations.md"), errorInheritanceRetirementQuote) {
		t.Fatal("missing VIP-13 inheritance rule")
	}
}
func FuzzErrorConstructorDiagnosticRetirement(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"zero", "one", "two", "optional", "default", "rest"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		toolsGuard(t, "FuzzErrorConstructorDiagnosticRetirement", func() {
			TestErrorConstructorRetirementQuoted(t)
			constructors := map[string]string{"zero": "", "one": "code:string", "two": "code:string,note:string", "optional": "code?:string", "default": "code:string=String()", "rest": "...args:string[]"}
			params, ok := constructors[key]
			if !ok {
				key = "zero"
				params = constructors[key]
			}
			field := "extra:number"
			if mode&1 != 0 {
				field = "readonly extra:string"
			}
			source := fmt.Sprintf("class Base {readonly _tag:string='Base';constructor(%s){}}\nexport error Child extends Base {%s}\n", params, field)
			result := toolsCompile(t, w, "FuzzErrorConstructorDiagnosticRetirement", map[string]string{"main.vibe": source})
			defer result.Remove()
			found := 0
			for _, d := range result.Diagnostics {
				if d.Code() == 2118 {
					t.Fatal("retired code escaped through a constructor shape")
				}
				if IsEK(d) && d.Code() == 2117 {
					found++
					continue
				}
				if d.Category().Name() == "error" {
					t.Fatalf("unexpected diagnostic: %v\n%s", d, source)
				}
			}
			if found != 1 {
				t.Fatalf("want one VIP-13 inheritance error, got %d", found)
			}
		})
	})
}
