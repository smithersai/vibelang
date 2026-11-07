package vibelang

import (
	"bytes"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Batch --fix of the legacy written infer return slots.
//
// rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | The migration does not add `effect`, `try` or execution merely because a return annotation qualified.
// rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | `--fix` writes checker-proved inferred channel types, preserving declaration types and runtime behavior, or refuses with an explanation if it cannot name those types safely.
// rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | It may remove the whole return annotation only on an explicitly `effect`-marked callable when every channel is `infer` and preservation is proved.

// legacyInferDeclared is the checker's type of the top-level declaration name.
func legacyInferDeclared(t *testing.T, source, name string) string {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	for _, statement := range file.Statements.Nodes {
		var named *ast.Node
		switch statement.Kind {
		case ast.KindFunctionDeclaration, ast.KindClassDeclaration:
			named = statement.Name()
		case ast.KindVariableStatement:
			named = statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Name()
		}
		if named != nil && named.Text() == name {
			return c.TypeToString(c.GetTypeAtLocation(named))
		}
	}
	t.Fatalf("no declaration %s in:\n%s", name, source)
	return ""
}

// legacyInferFixed is main.vibe after --fix (or --fix --fix-vip-only), or source when
// nothing was written, with the run's report.
func legacyInferFixed(t *testing.T, source string, vipOnly bool) (string, *FixResult, string) {
	t.Helper()
	result, name := fixSourceOptions(t, source, FixOptions{VIPOnly: vipOnly})
	var report bytes.Buffer
	result.Report(&report, func(tspath.RootedFilePath) string { return "main.vibe" })
	if fixed := result.Files[name]; fixed != nil {
		return fixed.Text, result, report.String()
	}
	return source, result, report.String()
}

// An unmarked callable in the legacy set gets its checker-proved channel
// types written, and stays unmarked: the fix adds no effect, no try and no
// execution, and the declared type is the one the checker inferred before.
// Every channel written infer is not reason enough to drop an unmarked
// callable's annotation.
func TestLegacyInferSlotFixKeepsUnmarkedCallablesPlain(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"export function p(): Effect.Effect<number, infer E> { return Effect.succeed(1) }\n",
			"export function p(): Effect.Effect<number, never> { return Effect.succeed(1) }\n"},
		{"export const p = function (): Effect.Effect<number, infer E, infer R> { return Effect.succeed(1) }\n",
			"export const p = function (): Effect.Effect<number, never, never> { return Effect.succeed(1) }\n"},
		{"export const p = { m(): number!infer E { return Effect.succeed(1) } }\n",
			"export const p = { m(): number!never { return Effect.succeed(1) } }\n"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			before := legacyInferDeclared(t, tc.source, "p")
			got, result, report := legacyInferFixed(t, tc.source, true)
			if got != tc.want || len(result.Refused) != 0 {
				t.Fatalf("--fix --fix-vip-only wrote\n%s\nwant\n%s\nreport:\n%s", got, tc.want, report)
			}
			if after := legacyInferDeclared(t, got, "p"); after != before {
				t.Errorf("declared type changed: %s, then %s", before, after)
			}
			// Ordinary --fix also respells the annotation; it still adds
			// no effect or try and keeps the declared type.
			full, _, report := legacyInferFixed(t, tc.source, false)
			if strings.Contains(full, "effect ") || strings.Contains(full, "try ") || strings.Contains(full, "infer ") {
				t.Errorf("--fix wrote\n%s\nreport:\n%s", full, report)
			}
			if after := legacyInferDeclared(t, full, "p"); after != before {
				t.Errorf("--fix changed the declared type: %s, then %s", before, after)
			}
		})
	}
}

// Removing the whole annotation is the fix only for an explicitly
// effect-marked callable whose every channel is infer; a marked callable
// with one written channel keeps its annotation, with the inferred types.
func TestLegacyInferSlotFixRemovesOnlyMarkedAllInfer(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"export effect function p(): Effect.Effect<infer A, infer E, infer R> { return 1 }\n",
			"export effect function p() { return 1 }\n"},
		{"export const p = effect (): infer A!infer E!infer R => 1\n",
			"export const p = effect () => 1\n"},
		{"export effect function p(): Effect.Effect<infer A, infer E, never> { return 1 }\n",
			"export effect function p(): Effect.Effect<number, never, never> { return 1 }\n"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			before := legacyInferDeclared(t, tc.source, "p")
			got, result, report := legacyInferFixed(t, tc.source, true)
			if got != tc.want || len(result.Refused) != 0 {
				t.Fatalf("--fix --fix-vip-only wrote\n%s\nwant\n%s\nreport:\n%s", got, tc.want, report)
			}
			if after := legacyInferDeclared(t, got, "p"); after != before {
				t.Errorf("declared type changed: %s, then %s", before, after)
			}
		})
	}
}

// An unmarked callable whose every channel is infer keeps an annotation: the
// fix writes the checker's channel types, in the annotation's own spelling
// (Effect.Effect<...> or the A!E!R shorthand), and does not remove it.
func TestLegacyInferSlotFixKeepsUnmarkedAllInferAnnotation(t *testing.T) {
	for _, source := range []string{
		"export function p(): Effect.Effect<infer A, infer E, infer R> { return Effect.succeed(1) }\n",
		"export const p = (): infer A!infer E!infer R => Effect.succeed(1)\n",
	} {
		t.Run(source, func(t *testing.T) {
			before := legacyInferDeclared(t, source, "p")
			got, result, report := legacyInferFixed(t, source, true)
			if got == source || strings.Contains(got, "infer ") || !(strings.Contains(got, "(): Effect.Effect<") || strings.Contains(got, "(): number!")) || strings.Contains(got, "effect ") || len(result.Refused) != 0 {
				t.Fatalf("--fix --fix-vip-only wrote\n%s\nreport:\n%s", got, report)
			}
			if after := legacyInferDeclared(t, got, "p"); after != before {
				t.Errorf("declared type changed: %s, then %s", before, after)
			}
		})
	}
}

// An unmarked legacy body that returns a plain value gains effect from the
// separate VIP-1 legacy-run migration, exactly as it does when no channel is
// written infer: the qualifying annotation adds nothing to that decision.
func TestLegacyInferSlotFixAddsNoEffectOfItsOwn(t *testing.T) {
	written, _, report := legacyInferFixed(t, "export function p(): Effect.Effect<number, never, never> { return 1 }\n", true)
	inferred, _, _ := legacyInferFixed(t, "export function p(): Effect.Effect<number, infer E, never> { return 1 }\n", true)
	if !strings.HasPrefix(written, "export effect function p()") {
		t.Fatalf("the legacy-run migration no longer marks this body; wrote\n%s\nreport:\n%s", written, report)
	}
	if inferred != written {
		t.Fatalf("an infer slot changed the migration:\n%s\nwithout infer:\n%s", inferred, written)
	}
}

// A channel whose inferred type cannot be named at the annotation, such as a
// class local to the body, is refused with an explanation; the file is not
// written.
func TestLegacyInferSlotFixRefusesUnnameableChannel(t *testing.T) {
	source := "export effect function p(): Effect.Effect<infer A, never, never> { class Local { n = 1 }; return new Local() }\n"
	for _, vipOnly := range []bool{true, false} {
		got, result, report := legacyInferFixed(t, source, vipOnly)
		if got != source {
			t.Fatalf("vip-only=%v: --fix wrote\n%s", vipOnly, got)
		}
		if len(result.Refused) != 1 || result.Refused[0].Code != EK4857.Code || !strings.Contains(result.Refused[0].Error, "Local") {
			t.Fatalf("vip-only=%v: refused %+v", vipOnly, result.Refused)
		}
		if !strings.Contains(report, "main.vibe:1: EK4857 not fixed: the fixed program would report") {
			t.Fatalf("vip-only=%v: report gives no explanation:\n%s", vipOnly, report)
		}
	}
}
