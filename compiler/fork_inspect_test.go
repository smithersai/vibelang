package compiler

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkSourceInspection(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	inspector := backend.(SourceInspector)
	t.Run("module literals have their own exact UTF16 spans and syntax kinds", func(t *testing.T) {
		const source = `// 😀` + "\u2028" + `import x from "./\u0061.vibe" with {type:"json"}; const later=import(` + "`./🐱.vibe`" + `);`
		got, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "literal.vibe", Text: source, ScriptKind: "typescript"}}})
		if err != nil || len(got.Files) != 1 || len(got.Files[0].ModuleSyntax) != 2 {
			t.Fatalf("literals: %+v err=%v", got, err)
		}
		units := utf16.Encode([]rune(source))
		for index, item := range got.Files[0].ModuleSyntax {
			wantKind, wantText, wantValue := "string", `"./\u0061.vibe"`, "./a.vibe"
			if index == 1 {
				wantKind, wantText, wantValue = "template", "`./🐱.vibe`", "./🐱.vibe"
			}
			if item.SpecifierSpan == nil || item.Specifier == nil || *item.Specifier != wantValue || item.SpecifierKind != wantKind {
				t.Fatalf("literal identity: %+v", item)
			}
			span := item.SpecifierSpan
			if actual := string(utf16.Decode(units[span.Start : span.Start+span.Length])); actual != wantText {
				t.Fatalf("literal span: %q, want %q", actual, wantText)
			}
		}
	})
	t.Run("authored top-level statements are distinct from nested syntax", func(t *testing.T) {
		const source = `import "./first"; namespace N { export * from "./nested"; import X = require("./inside"); } export * from "./last"; import("./dynamic"); type T = import("./type").T;`
		got, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "source.vibe", Text: source, ScriptKind: "typescript"}}})
		if err != nil || len(got.Files) != 1 || len(got.Files[0].ModuleSyntax) != 6 {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		for index, item := range got.Files[0].ModuleSyntax {
			if item.TopLevel != (index == 0 || index == 3) {
				t.Fatalf("unexpected source scope: %+v", got.Files[0])
			}
		}
	})
	for _, vector := range []struct{ name, text, kind, syntax, specifier string }{
		{"import", `import x from "./a.js"`, "typescript", "import-declaration", "./a.js"},
		{"erased import", `import type { T } from "./a.js"`, "typescript", "import-declaration", "./a.js"},
		{"reexport", `export * from "./b.js"`, "typescript", "module-re-export", "./b.js"},
		{"import equals", `import x = require("./c.js")`, "typescript", "import-equals", "./c.js"},
		{"import type", `type T = import("./d.js").T`, "typescript", "import-type", "./d.js"},
		{"dynamic import", `const f = () => import("./e.js")`, "javascript", "dynamic-import", "./e.js"},
		{"nonliteral import", `const f = () => import(name)`, "typescript", "dynamic-import", ""},
		{"metadata", `const x = import.meta.url`, "javascript", "import-meta", ""},
		{"literal require", `const x = require("./f.js")`, "javascript", "require", "./f.js"},
		{"require resolve", `const x = require.resolve("./g.js")`, "javascript", "require-resolve", "./g.js"},
		{"relative URL", `const x = new URL("./asset.bin", import.meta.url)`, "javascript", "module-url", "./asset.bin"},
		{"template import", "const x = import(`./h.js`)", "typescript", "dynamic-import", "./h.js"},
		{"plain undefined names are not checked", `const x: MissingType = unknownValue`, "typescript", "", ""},
		{"JSX", `const x = <div>{missing}</div>`, "jsx", "", ""},
		{"TSX", `const x: Element = <div>{missing}</div>`, "tsx", "", ""},
		{"comments and strings", `const x = "import('./fake.js')"; // require("false")`, "typescript", "", ""},
	} {
		t.Run(vector.name, func(t *testing.T) {
			result, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "source.ts", Text: vector.text, ScriptKind: vector.kind}}})
			if err != nil {
				t.Fatal(err)
			}
			file := result.Files[0]
			if len(file.Diagnostics) != 0 {
				t.Fatalf("unexpected parsing errors: %+v", file.Diagnostics)
			}
			if vector.syntax == "" {
				if len(file.ModuleSyntax) != 0 {
					t.Fatal("invented a module access")
				}
				return
			}
			if len(file.ModuleSyntax) == 0 || file.ModuleSyntax[0].Kind != vector.syntax {
				t.Fatalf("wrong module facts: %+v", file.ModuleSyntax)
			}
			item := file.ModuleSyntax[0]
			if vector.specifier == "" {
				if item.Specifier != nil {
					t.Fatal("invented a literal target")
				}
			} else if item.Specifier == nil || *item.Specifier != vector.specifier {
				t.Fatalf("wrong target: %+v", item)
			}
		})
	}
	t.Run("batched parser diagnostics and Unicode fact spans", func(t *testing.T) {
		const source = "// 🦀\r\nimport('./a.js')"
		result, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{
			{Path: "broken.ts", Text: "export const = ;", ScriptKind: "typescript"},
			{Path: "unicode.js", Text: source, ScriptKind: "javascript"},
		}})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Files[0].Diagnostics) == 0 || result.Files[0].Diagnostics[0].File != "broken.ts" {
			t.Fatal("lost parser refusal")
		}
		if result.Files[1].ModuleSyntax[0].Span.Start != 7 {
			t.Fatalf("not UTF16: %+v", result.Files[1])
		}
	})
	t.Run("Unicode offsets on both sides of checkpoint boundaries", func(t *testing.T) {
		files := []InspectionSource{}
		for _, size := range []int{1018, 1020, 1021, 1022, 1023, 1024, 2043, 2048, 4096} {
			prefix := "/*" + strings.Repeat("a", size) + strings.Repeat("🦀e\u0301", 600) + "*/"
			files = append(files, InspectionSource{Path: fmt.Sprintf("unicode-%d.ts", size), Text: prefix + "import('x')", ScriptKind: "typescript"})
		}
		result, err := inspector.Inspect(ctx, InspectionRequest{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		for index, file := range result.Files {
			want := len(utf16.Encode([]rune(strings.Split(files[index].Text, "import")[0])))
			if file.ModuleSyntax[0].Span.Start != want || file.ModuleSyntax[0].Span.Length != len("import('x')") {
				t.Fatalf("checkpoint offset mismatch: %+v", file)
			}
		}
	})
	for _, text := range []string{"import", "import x =", "export * from", "import(", "type X = import(", "new", "new URL(", "require.(", "import."} {
		t.Run("incomplete "+text, func(t *testing.T) {
			result, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "broken.ts", Text: text, ScriptKind: "typescript"}}})
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Files[0].Diagnostics) == 0 {
				t.Fatal("incomplete syntax had no diagnostic")
			}
		})
	}
	for _, files := range [][]InspectionSource{
		nil,
		{{Path: "source.ts", ScriptKind: "bogus"}},
		{{Path: "../escape.ts", ScriptKind: "typescript"}},
		{{Path: "source.ts", ScriptKind: "typescript"}, {Path: "./source.ts", ScriptKind: "typescript"}},
	} {
		t.Run("invalid input", func(t *testing.T) {
			if _, err := inspector.Inspect(ctx, InspectionRequest{Files: files}); err == nil {
				t.Fatal("invalid inspection request accepted")
			}
		})
	}
	t.Run("module syntax budget refuses instead of returning truncated facts", func(t *testing.T) {
		_, err := inspector.Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "many.ts", Text: strings.Repeat("import('x');", 100_001), ScriptKind: "typescript"}}})
		if err == nil || !strings.Contains(err.Error(), "100000 entry budget") {
			t.Fatalf("expected bounded refusal, got %v", err)
		}
	})
}
