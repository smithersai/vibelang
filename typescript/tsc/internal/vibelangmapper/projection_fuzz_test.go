package vibelangmapper

import (
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
)

func TestMalformedRegionProjection(t *testing.T) {
	const source = "0000000000000000000000000000000000000000000(A0{0try {000000000000000(00}(}"
	checking := Project(source, testContext)
	// Native recovery no longer synthesizes the trailing block that made
	// this witness produce overlapping edits. Preserve its bytes and mapping
	// even when the normal prelude marker precedes the invalid input.
	if !strings.HasSuffix(checking.Text, source) {
		t.Fatalf("invalid edit lost source text: %q", checking.Text)
	}
	assertValidMap(t, checking, source)
	executable := Executable(source, testContext)
	if executable.Text != "" && !strings.HasSuffix(executable.Text, source) {
		t.Fatalf("invalid edit lost executable source bytes: %q", executable.Text)
	}
	assertValidMap(t, executable, source)
	js, _, diagnostics := Emit(source, testContext)
	if strings.Contains(js, "=>") || len(diagnostics) == 0 {
		t.Fatalf("native recovery must diagnose the source without a callback: %q; %v", js, diagnostics)
	}
	for _, d := range diagnostics {
		if d.Code != CodeExecSyntax {
			t.Fatalf("expected native syntax diagnostic: %+v", d)
		}
	}
}

func TestRegionJumpWithoutTarget(t *testing.T) {
	for _, statement := range []string{"break", "continue", "break missing", "continue missing"} {
		t.Run(statement, func(t *testing.T) {
			source := "function f() { try { " + statement + "; } catch {} }"
			for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
				// Keep the invalid jump in the generated function so TypeScript
				// can diagnose its missing target during an incomplete edit.
				if !strings.Contains(projection.Text, statement) {
					t.Fatalf("projection lost the unresolved jump: %s", projection.Text)
				}
				assertValidMap(t, projection, source)
			}
		})
	}
}

func TestQualifiedControlProjection(t *testing.T) {
	const source = "function f() { try { return API.Ask.get() } handle API.Ask.get() { resume(true) } }"
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if !strings.Contains(projection.Text, "API.Ask") {
			t.Fatalf("projection lost the qualified control: %s", projection.Text)
		}
		assertValidMap(t, projection, source)
	}
}

func TestIncompleteLoopBindingProjection(t *testing.T) {
	for _, source := range []string{"function{for const of A)}", "function f() { for (const of xs) {} }"} {
		checking := Project(source, testContext)
		executable := Executable(source, testContext)
		if len(executable.Diagnostics) == 0 {
			t.Fatalf("missing diagnostic for incomplete loop: %q", source)
		}
		assertValidMap(t, checking, source)
		assertValidMap(t, executable, source)
	}
}

func TestIncompleteConcurrentBodyProjection(t *testing.T) {
	const source = "A{for concurrent(0\"}"
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(projection.Diagnostics) == 0 {
			t.Fatalf("missing diagnostic for incomplete concurrent loop: %q", source)
		}
		assertValidMap(t, projection, source)
	}
}

// FuzzProjectionSpans checks the contracts TypeScript's cache and editor
// depend on: identical source/context has identical projections, diagnostics
// stay inside the original text, and verbatim spans map to their exact source.
// Include incomplete and invalid edits, because editors project these too.
func FuzzProjectionSpans(f *testing.F) {
	for _, tc := range projectionCases {
		f.Add(tc.source)
	}
	for _, source := range []string{"", "\x00", "service", "function f( {", "// 😀\u2028export const café = 1", "service S { read(): #Bad!0 }", "function f(xs: number[]) { for concurrent (const x of xs)"} {
		f.Add(source)
	}
	f.Fuzz(func(t *testing.T, source string) {
		if len(source) > 16*1024 {
			t.Skip()
		}
		for name, project := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
			projection := project(source, testContext)
			if again := project(source, testContext); !reflect.DeepEqual(projection, again) {
				t.Fatalf("%s projection is not deterministic for %q", name, source)
			}
			mapping := spanmap.New(projection.Segments)
			if err := mapping.Validate(projection.Text, source); err != nil {
				t.Fatalf("%s: invalid editor mapping for %q: %v", name, source, err)
			}
			for _, segment := range projection.Segments {
				if segment.Kind != spanmap.KindVerbatim {
					continue
				}
				virtual := core.NewTextRange(int(segment.VirtualStart), int(segment.VirtualEnd))
				original, fidelity := mapping.VirtualToOriginalSpan(virtual)
				if !fidelity.IsExact() || original.Pos() != int(segment.OriginalStart) || original.End() != int(segment.OriginalEnd) {
					t.Fatalf("%s: verbatim span %+v maps to %v with fidelity %v", name, segment, original, fidelity)
				}
			}
			for _, diagnostic := range projection.Diagnostics {
				if diagnostic.Start < 0 || diagnostic.Length < 0 || diagnostic.Start+diagnostic.Length > len(source) {
					t.Fatalf("%s: diagnostic outside source (%d bytes): %+v", name, len(source), diagnostic)
				}
			}
		}
	})
}

// A recovered missing operand must not produce overlapping edits that discard
// the valid functions after the incomplete statement (malformed-pipe-topic).
func TestIncompletePipePreservesFollowingFunction(t *testing.T) {
	for _, source := range []string{
		"const e = |> %; export function main() { return 1 }",
		"const e = 1 |> ; export function main() { return 1 }",
	} {
		checking := Project(source, testContext)
		executable := Executable(source, testContext)
		for _, projection := range []Projection{checking, executable} {
			assertValidMap(t, projection, source)
			for _, diagnostic := range projection.Diagnostics {
				if strings.Contains(diagnostic.Message, "invalid or overlapping edits") {
					t.Fatalf("incomplete pipe corrupted the lowering plan: %+v", diagnostic)
				}
			}
		}
		if !strings.Contains(executable.Text, "function main$direct(") {
			t.Fatalf("incomplete pipe lost the following pure function: %s", executable.Text)
		}
		_, _, diagnostics := Emit(source, testContext)
		if len(diagnostics) == 0 {
			t.Fatal("the incomplete pipe must still be rejected")
		}
	}
}
