package vibelangfuzz

import (
	"fmt"
	"testing"
)

func TestDataComputedTagDiagnostics(t *testing.T) {
	w := NewWorkspace(t)
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"computed-tag-literal-double", "export data D { A { readonly [\"_tag\"]:string } }", 1601},
		{"computed-tag-literal-single", "export data D { A { readonly ['_tag']:string } }", 1601},
		{"computed-tag-literal-escaped", "export data D { A { readonly [\"\\u005ftag\"]:string } }", 1601},
		{"computed-tag-entity", "const key=\"_tag\";export data D { A { readonly [key]:string } }", 1601},
		{"computed-tag-entity-const", "const key=\"_tag\" as const;export data D { A { readonly [key]:string } }", 1601},
		{"computed-tag-qualified", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names.tag]:string } }", 1601},
		{"computed-tag-literal-double-optional", "export data D { A { readonly [\"_tag\"]?:string } }", 1601},
		{"computed-tag-literal-single-optional", "export data D { A { readonly ['_tag']?:string } }", 1601},
		{"computed-tag-literal-escaped-optional", "export data D { A { readonly [\"\\u005ftag\"]?:string } }", 1601},
		{"computed-tag-entity-optional", "const key=\"_tag\";export data D { A { readonly [key]?:string } }", 1601},
		{"computed-tag-entity-const-optional", "const key=\"_tag\" as const;export data D { A { readonly [key]?:string } }", 1601},
		{"computed-tag-qualified-optional", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names.tag]?:string } }", 1601},
		{"computed-tag-enum-control", "enum Key { Tag=\"_tag\" };export data D { A { readonly [Key.Tag]:string } }", 0},
		{"computed-tag-broad-control", "declare const key:string;export data D { A { readonly [key]:string } }", 2344},
		{"computed-tag-symbol-control", "declare const key:unique symbol;export data D { A { readonly [key]:string } }", 0},
		{"computed-tag-ordinary-control", "const key=\"field\";export data D { A { readonly [key]:string } }", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": tc.source + "\n"}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var codes []int32
			for _, d := range result.Diagnostics {
				codes = append(codes, d.Code())
			}
			if tc.code == 0 {
				if len(codes) != 0 {
					t.Fatalf("unexpected diagnostics: %v", codes)
				}
			} else if len(codes) != 1 || codes[0] != tc.code {
				t.Fatalf("want only %d, got %s", tc.code, fmt.Sprint(codes))
			}
		})
	}
}
