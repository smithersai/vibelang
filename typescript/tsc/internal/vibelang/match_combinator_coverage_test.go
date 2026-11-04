package vibelang

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestMatchCombinatorCoverage(t *testing.T) {
	for _, pattern := range []string{"true and true", "true and Boolean", "not false", "(true and true) or false", "(true and true)"} {
		t.Run(pattern, func(t *testing.T) {
			source := fmt.Sprintf("export function f(x:boolean){return match(x){when %s:1;when false:0;}}", pattern)
			p, f, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Code() == EK4701.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Error(d.String())
				}
			}
			if count != 1 {
				t.Fatalf("got %d EK4701 diagnostics, want one", count)
			}
		})
	}
}

func TestMatchCombinatorCoverageFix(t *testing.T) {
	for _, modifier := range []string{"", "async ", "effect "} {
		source := "export " + modifier + "function f(x:boolean){return match(x){when true and true:1;when false:0;}}"
		got := applyQuickFixOf(t, source, EK4701.Code, diagnostics.CategoryError)
		if ds := errorsOf(t, got); len(ds) != 0 {
			t.Fatalf("fixed source: %v\n%s", ds, got)
		}
		// The fallback contributes never, never a new success/error/environment.
		want := combinatorDeclarations(t, "export "+modifier+"function f(x:boolean){return match(x){when true:1;when false:0;}}")
		actual := combinatorDeclarations(t, got)
		if actual != want {
			t.Fatalf("declarations changed:\n%s\nwant:\n%s", actual, want)
		}
	}
}

func TestMatchCombinatorCoverageControls(t *testing.T) {
	for i, source := range []string{
		"export function f(x:boolean){return match(x){when true and true:1;when false:0;default:2;}}",
		"export function f(x:boolean){return match(x){when true or false:1;}}",
		"export function f(x:boolean){return match(x){when true and true:1;when false:0;when let rest:2;}}",
		"export function f(x:string|number){return match(x){when not String: x+1;default:x.length;}}",
		"export function f(x:true|false){if(x is true and true){const v:true=x;return v}return false}",
		"export function f(x:unknown){return match(x){when not false:1;}}",
		"export function f(x:boolean){return match(x){when true and true:do {const yes:true=x;yes};default:do{const no:false=x;no};}}",
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			if ds := errorsOf(t, source); len(ds) != 0 {
				t.Fatal(ds)
			}
		})
	}
}

func TestMatchCombinatorCoverageCLI(t *testing.T) {
	for _, options := range []FixOptions{{}, {MigrationOnly: true}} {
		for _, modifier := range []string{"", "effect "} {
			source := "export " + modifier + "function f(x:boolean){const TypeError=0;const Effect=0;return match(x){when true and true:1;when false:0;}}"
			program, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("options=%+v modifier=%q fix result: %+v", options, modifier, result)
			}
			fixed := result.Files[file.FileName()]
			if fixed.Counts[EK4701.Code] != 1 {
				t.Fatalf("missing repair count: %+v", fixed)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			second := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
			if len(second.Files) != 0 || len(second.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", second)
			}
		}
	}
}

func TestMatchCombinatorTaggedCoverage(t *testing.T) {
	for _, pattern := range []string{`{_tag:"A"} and {_tag:"A"}`, `A and A`, `(A and A) or (B and B)`} {
		source := `error A;error B;export function f(x:A|B){return match(x){when ` + pattern + `:1;when B:0;}}`
		ds := errorsOf(t, source)
		if len(ds) != 1 || ds[0].Code() != EK4701.Code {
			t.Fatalf("%s: %v", pattern, ds)
		}
	}
}

func TestMatchCombinatorNativeComparison(t *testing.T) {
	// Native TS2367 is independent of the finite coverage projection.
	source := "export function f(x:boolean){return match(x){when true and true:1;when true:2;default:0;}}"
	ds := errorsOf(t, source)
	if len(ds) != 1 || ds[0].Code() != 2367 {
		t.Fatalf("native comparison: %v", ds)
	}
}

func combinatorDeclarations(t *testing.T, source string) string {
	t.Helper()
	p, f, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatal(d.String())
		}
	}
	text := ""
	p.Emit(t.Context(), compiler.EmitOptions{ForceEmit: true, EmitOnly: compiler.EmitOnlyDts, WriteFile: func(name tspath.RootedFilePath, contents string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "/main.d.ts") {
			text = contents
		}
		return nil
	}})
	if text == "" {
		t.Fatal("no declaration emitted")
	}
	return text
}

func TestMatchNestedBindingCombinatorCoverage(t *testing.T) {
	for name, source := range map[string]string{
		"right":     `export function f(x:boolean){return match(x){when true and let v:v;when false:false;}}`,
		"left":      `export function f(x:boolean){return match(x){when const v and true:v;when false:false;}}`,
		"only":      `export function f(x:boolean){return match(x){when let v and let w:v;}}`,
		"error-tag": `error A;error B;export function f(x:A|B){return match(x){when A and let a:a;when B and let b:b;}}`,
		"tagged":    `type T={_tag:"A"}|{_tag:"B"};export function f(x:T){return match(x){when {_tag:"A"} and let a:a;when let b and {_tag:"B"}:b;}}`,
		"tag-cases": `type T={_tag:"A"|"B"};export function f(x:T){return match(x){when {_tag:"A"} and let a:a;when let b and {_tag:"B"}:b;}}`,
		"generic":   `export function f<T extends {_tag:"A"}|{_tag:"B"}>(x:T){return match(x){when {_tag:"A"} and let a:a;when let b and {_tag:"B"}:b;}}`,
		"tag-field": `type T={_tag:"A"|"B"};export function f(x:T){return match(x){when {_tag:("A" and let a)}:a;when {_tag:(let b and "B")}:b;}}`,
		"or":        `export function f(x:boolean){return match(x){when (true and let a) or (false and let a):a;}}`,
		"field":     `type T={_tag:"A";n:number}|{_tag:"B"};export function f(x:T){return match(x){when {_tag:"A",n:(let a and let b)}:1;when {_tag:"B"}:0;}}`,
		"extractor": `error A;error B;export function f(x:A|B){return match(x){when A(let a and let b):1;when B:0;}}`,
	} {
		t.Run(name, func(t *testing.T) {
			ds := errorsOf(t, source)
			if len(ds) != 0 {
				t.Fatalf("irrefutable captures changed coverage: %v", ds)
			}
		})
	}
}

func TestMatchCaptureKeepsRefutableAlternative(t *testing.T) {
	for _, pattern := range []string{
		"(true and true) or false",
		"((true and true) or false) and let value",
		"let value and ((true and true) or false)",
		"(((true and true) or false) and let value) and const other",
	} {
		source := "export function f(x:boolean){return match(x){when " + pattern + ":1;}}"
		p, file, _, _ := editorProgram(t, source)
		ds := p.GetSemanticDiagnostics(t.Context(), file)
		gaps := 0
		for _, d := range ds {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() != EK4701.Code {
				t.Fatalf("%s: %s", pattern, d.String())
			}
			gaps++
			if !strings.Contains(d.String(), "true is left") {
				t.Fatalf("%s: capture changed the remaining cases: %s", pattern, d.String())
			}
		}
		if gaps != 1 {
			t.Fatalf("%s: got %d gaps, want one", pattern, gaps)
		}
	}
}
