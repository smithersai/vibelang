package compiler

import (
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkJSONInspection(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	inspector := backend.(SourceInspector)
	for _, tc := range []struct {
		name, text string
		duplicates []string
	}{
		{"empty object", `{}`, []string{}},
		{"empty array", `[]`, []string{}},
		{"scalar", `"value"`, []string{}},
		{"unique", `{"name":1,"Name":2}`, []string{}},
		{"same names in separate objects", `[{"x":1},{"x":2}]`, []string{}},
		{"duplicate", `{"name":1,"name":2}`, []string{`"name"`}},
		{"empty key", `{"":1,"":2}`, []string{`""`}},
		{"prototype is data", `{"__proto__":1,"__proto__":2}`, []string{`"__proto__"`}},
		{"cooked key", `{"x":1,"\u0078":2}`, []string{`"\u0078"`}},
		{"astral key", `{"🦀":1,"\ud83e\udd80":2}`, []string{`"\ud83e\udd80"`}},
		{"no Unicode normalization", `{"é":1,"e\u0301":2}`, []string{}},
		{"unpaired escape identity", `{"\ud800":1,"\ud800":2,"\ud801":3,"�":4}`, []string{`"\ud800"`}},
		{"unpaired escape not replacement", `{"\ud800":1,"\ud801":2,"�":3}`, []string{}},
		{"parent before nested", `{"inside":{"x":1,"x":2},"a":1,"a":2}`, []string{`"a"`, `"x"`}},
		{"multiple occurrences", `{"x":1,"x":2,"x":3}`, []string{`"x"`, `"x"`}},
		{"config comments", "// config\n{\"x\":1,/*keep*/\"x\":2,}", []string{`"x"`}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "config.json", Text: tc.text, ScriptKind: "json"}}})
			if err != nil || len(got.Files) != 1 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			file := got.Files[0]
			if len(file.Diagnostics) != 0 || len(file.ModuleSyntax) != 0 || file.JSONDuplicateKeys == nil {
				t.Fatalf("%+v", file)
			}
			units := utf16.Encode([]rune(tc.text))
			actual := []string{}
			for _, key := range *file.JSONDuplicateKeys {
				if key.Start < 0 || key.Length < 2 || key.Start+key.Length > len(units) {
					t.Fatalf("unbounded key %+v", key)
				}
				actual = append(actual, string(utf16.Decode(units[key.Start:key.Start+key.Length])))
			}
			if !reflect.DeepEqual(actual, tc.duplicates) {
				t.Fatalf("wanted %q, got %q (%+v)", tc.duplicates, actual, file.JSONDuplicateKeys)
			}
		})
	}
	for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		t.Run("Unicode position "+newline, func(t *testing.T) {
			prefix := "// 🦀" + newline
			text := prefix + `{"x":1,"x":2}`
			got, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "config.json", Text: text, ScriptKind: "json"}}})
			if err != nil || len(got.Files) != 1 || got.Files[0].JSONDuplicateKeys == nil || len(*got.Files[0].JSONDuplicateKeys) != 1 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			want := Span{Start: len(utf16.Encode([]rune(prefix))) + 7, Length: 3}
			if (*got.Files[0].JSONDuplicateKeys)[0] != want {
				t.Fatalf("got=%+v want=%+v", got.Files[0].JSONDuplicateKeys, want)
			}
		})
	}
	for _, text := range []string{`{"x":}`, `import("x")`} {
		t.Run("recovery remains data "+text, func(t *testing.T) {
			got, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "config.json", Text: text, ScriptKind: "json"}}})
			if err != nil || len(got.Files) != 1 || len(got.Files[0].Diagnostics) == 0 || got.Files[0].JSONDuplicateKeys == nil || len(got.Files[0].ModuleSyntax) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	t.Run("JSON property budget", func(t *testing.T) {
		text := "{" + strings.Repeat(`"x":0,`, 100_000) + `"last":1}`
		_, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "config.json", Text: text, ScriptKind: "json"}}})
		if err == nil || !strings.Contains(err.Error(), "100000 property budget") {
			t.Fatalf("budget not enforced: %v", err)
		}
	})
}
