package vibelangfmt

import (
	"fmt"
	"strings"
	"testing"
)

func TestFormatErrorEmptyClassElements(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"error", "schema error"} {
		for _, members := range []string{";;", ";; get label() { return 1 } ;;", ";; id: string; ;;", ";; id: string; ;; get label() { return this.id } ;;"} {
			t.Run(kind+"/"+members, func(t *testing.T) {
				source := kind + " E { " + members + " }\n"
				// dprint drops empty class elements while retaining the field
				// separator. Exercise the same valid TypeScript rewrite.
				got, err := Format("main.vibe", source, func(text string) (string, error) {
					return strings.ReplaceAll(text, ";;", ""), nil
				})
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(got, ";;") {
					t.Fatalf("empty elements survived: %s", got)
				}
			})
		}
	}
	if err := SameProgram("class C { ;; x = 1; ;; }", "class C { x = 1 }"); err != nil {
		t.Fatal(err)
	}
	if err := SameProgram("class C { ;; x = 1; ;; }", "class C {}"); err == nil {
		t.Fatal("dropping an initialized field must still change the program")
	}
}

func TestFormatEmptyClassElementJSDoc(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"class", "error", "schema error"} {
		for _, comment := range []string{"/** @internal */", "/** @throws {Error} */", "/** documentation */"} {
			for _, removeSemicolon := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/remove=%v", kind, comment, removeSemicolon), func(t *testing.T) {
					source := kind + " E {\n" + comment + " ;\nvisible(): number { return 1 }\n}\n"
					got, err := Format("main.vibe", source, func(text string) (string, error) {
						if removeSemicolon {
							return strings.ReplaceAll(text, ";\n", "\n"), nil
						}
						return text, nil
					})
					if err != nil {
						t.Fatalf("%s %s remove=%v: %v", kind, comment, removeSemicolon, err)
					}
					if !strings.Contains(got, comment) {
						t.Fatalf("lost comment: %s", got)
					}
					if err := SameProgram(source, got); err != nil {
						t.Fatal(err)
					}
				})
			}
		}
	}
	before := "class C { /** @internal */ ; visible(): number { return 1 } }"
	after := "class C { /** @internal */ visible(): number { return 1 } }"
	if err := SameProgram(before, after); err == nil {
		t.Fatal("moving @internal off an empty member changes declaration output")
	}
	_, err := Format("main.vibe", "class C { /** @internal */ ;\nvisible() {} }", func(text string) (string, error) {
		return strings.Replace(text, ";\n", " = sideEffect();\n", 1), nil
	})
	if err == nil {
		t.Fatal("formatter must not add an initializer to the temporary property")
	}
}
