package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-7: a structurally compatible value need not pass instanceof.
func TestForeignTaggedClassCoverage(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		missing      bool
	}{
		{"tagged-error", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when Wanted:1;}}", true},
		{"alias", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}const Alias=Wanted;function f(s:Wanted){return match(s){when Alias:1;}}", true},
		{"property", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}const Types={Wanted};function f(s:Wanted){return match(s){when Types.Wanted:1;}}", true},
		{"subclass", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}class Child extends Wanted{}function f(s:Child){return match(s){when Child:1;}}", true},
		{"or", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}class Another extends Data.TaggedError(\"Other\")<{}>{}function f(s:Wanted|Another){return match(s){when Wanted or Another:1;}}", true},
		{"nested", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:{_tag:\"A\",value:Wanted}|{_tag:\"B\"}){return match(s){when {_tag:\"A\",value:Wanted}:1;when {_tag:\"B\"}:2;}}", true},
		{"generic", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f<T extends Wanted>(s:T){return match(s){when Wanted:1;}}", true},
		{"data-error", "class Wanted extends Data.Error<{}>{readonly _tag=\"Shared\" as const}function f(s:Wanted){return match(s){when Wanted:1;}}", true},
		{"native-tagged", "class Wanted extends Error{readonly _tag=\"Shared\" as const}function f(s:Wanted){return match(s){when Wanted:1;}}", true},
		{"default", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when Wanted:1;default:0;}}", false},
		{"tag-object", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when {_tag:\"Shared\"}:1;}}", false},
		{"binding", "class Wanted extends Data.TaggedError(\"Shared\")<{}>{}function f(s:Wanted){return match(s){when Wanted:1;when let rest:0;}}", false},
		{"open", "class Plain{}function f(s:Plain){return match(s){when Plain:1;}}", false},
		{"generated-error", "error Wanted {} function f(s:Wanted){return match(s){when Wanted:1;}}", false},
		{"generated-schema-error", "schema error Wanted {} function f(s:Wanted){return match(s){when Wanted:1;}}", false},
		{"fixed", "function f(s:Option.Option<number>){return match(s){when Option.Some(let n):n;when Option.None:0;}}", false},
		{"retained-error", "function f(s:Cause.TimeoutError){return match(s){when Cause.TimeoutError:1;}}", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == diagnosticSource && d.Code() == EK4701.Code {
					count++
				} else {
					t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			want := 0
			if tc.missing {
				want = 1
			}
			if count != want {
				t.Errorf("EK4701 count %d, want %d", count, want)
			}
		})
	}
}
