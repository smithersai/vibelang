package vibelangfmt

import (
	"strings"
	"testing"
)

func TestDeclarationKeywordSpacing(t *testing.T) {
	// The headers are opaque to the TypeScript formatter. Even a host which
	// leaves its input alone must receive normalized declaration keywords.
	for _, source := range []string{
		"error   Oops{code:number}",
		"error\tOops",
		"error   Oops extends Base {}",
		"schema   User{id:string}",
		"schema   Code = string",
		"schema   error   Oops{code:number}",
		"service   Users{find():Effect<string>}",
		"service   class   Users{find():Effect<string>}",
		"service   Prefix:   string",
		"control   Approval{approve():Effect<boolean>}",
		"data   Shape{Sq{s:number}}",
		"layer   Live: Users { find() { return \"x\" } }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := Format("test.vibe", source, func(text string) (string, error) { return text, nil })
			if err != nil {
				t.Fatal(err)
			}
			for _, keyword := range []string{"error", "schema", "service", "class", "control", "data", "layer"} {
				if strings.Contains(result, keyword+"   ") || strings.Contains(result, keyword+"\t") {
					t.Fatalf("extra whitespace after %s: %s", keyword, result)
				}
			}
			if err := SameProgram(source, result); err != nil {
				t.Fatal(err)
			}
			again, err := Format("test.vibe", result, func(text string) (string, error) { return text, nil })
			if err != nil || again != result {
				t.Fatalf("not idempotent: %s (%v)", again, err)
			}
		})
	}
}

func TestDeclarationKeywordComments(t *testing.T) {
	for _, source := range []string{
		"error /* explanation */   Oops { code: number }",
		"schema /* explanation */ error   Oops { code: number }",
		"service /* explanation */ Users { name: string }",
	} {
		result, err := Format("test.vibe", source, func(text string) (string, error) { return text, nil })
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(result, "/* explanation */") && strings.Contains(source, "/*") {
			t.Fatalf("lost comment: %s", result)
		}
		if err := SameProgram(source, result); err != nil {
			t.Fatal(err)
		}
	}
}
