package vibelangfmt

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

func TestAmbientDataMissingBodyPreserved(t *testing.T) {
	for _, head := range []string{"data D", "data D<T>", "data /* keep 😀 */ D<T>"} {
		for _, wrap := range []string{"declare %s\n", "export declare %s;\n", "declare namespace N { %s }\n", "export {}; declare global { %s }\n"} {
			source := fmt.Sprintf(wrap, head)
			t.Run(source, func(t *testing.T) {
				identity := func(text string) (string, error) { return text, nil }
				got, err := Format("ambient.vibe", source, identity)
				if err != nil {
					t.Fatal(err)
				}
				again, err := Format("ambient.vibe", got, identity)
				if err != nil || again != got {
					t.Fatalf("format not idempotent: %v\n%s\n%s", err, got, again)
				}
				if strings.Contains(source, "keep 😀") && !strings.Contains(got, "keep 😀") {
					t.Fatal("lost comment")
				}
				_, forms := parser.ParseVibeLangSyntax(vibeOptions, got)
				count := 0
				for _, form := range forms {
					if form.Kind == parser.VibeSyntaxDeclaration && form.Name == parser.VibeSyntaxData {
						count++
						if form.Open.Pos() != form.Open.End() {
							t.Fatal("formatter added a data body")
						}
					}
				}
				if count != 1 {
					t.Fatalf("lost declaration: %s", got)
				}
			})
		}
	}
}
