package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const declarationOrderTarget = "FuzzDeclarationOrder"
const declarationOrderQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

// declarationOrderFunctions are plain functions whose return type is a union
// of object literals, to which the checker adds each missing property as
// `name?: never`. Its readonly-ness must follow the function's own literal,
// whatever function the checker reached first (t3code's AttachmentUpload,
// drive-t3code-server 22:53Z).
func declarationOrderFunctions(choice uint32) []string {
	names := []string{"status", "kind", "id"}
	values := []string{"1", "\"done\"", "true"}
	var fns []string
	for i := range 3 {
		bits := (choice >> (5 * i)) & 31
		name := names[bits%3]
		value := values[(bits/3)%3]
		constant := ""
		if bits&16 != 0 {
			constant = " as const"
		}
		fns = append(fns, fmt.Sprintf("export function f%d(b: boolean): infer _ {\n  if (b) return { %s: %s }%s\n  return {}\n}\n", i, name, value, constant))
	}
	return fns
}

// declarationsByFunction splits a declaration file into each function's text.
func declarationsByFunction(dts string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(dts, "export declare function ")[1:] {
		name, _, _ := strings.Cut(part, "(")
		out[name] = part
	}
	return out
}

func TestDeclarationOrderQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), declarationOrderQuote) {
		t.Fatalf("Chapter 1 no longer says %q", declarationOrderQuote)
	}
}

func checkDeclarationOrder(t *testing.T, w *Workspace, choice uint32) {
	t.Helper()
	TestDeclarationOrderQuoted(t)
	fns := declarationOrderFunctions(choice)
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"exactOptionalPropertyTypes":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
	emit := func(order []int) map[string]string {
		var source strings.Builder
		for _, i := range order {
			source.WriteString(fns[i])
		}
		var result *Result
		var err error
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source.String()}, Config: config})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Skipf("not a program of accepted constructs: %s", d.String())
			}
		}
		return declarationsByFunction(result.Outputs["out/main.d.ts"])
	}
	forward, backward := emit([]int{0, 1, 2}), emit([]int{2, 1, 0})
	for name, text := range forward {
		if backward[name] != text {
			Gap(t, declarationOrderTarget, "feature:optional-never-readonly", "Chapter 1: %q; %s declares\n%s\nin one order and\n%s\nin the other, for\n%s", declarationOrderQuote, name, text, backward[name], strings.Join(fns, ""))
		}
	}
	ExpectPending(t, declarationOrderTarget, "feature:optional-never-readonly")
}

func FuzzDeclarationOrder(f *testing.F) {
	startShortBudget(f)
	for _, choice := range []uint32{0, 18, 18 | 18<<5, 1 | 18<<5, 18 | 1<<10} {
		f.Add(choice)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, choice uint32) {
		checkDeclarationOrder(t, w, choice)
	})
}
