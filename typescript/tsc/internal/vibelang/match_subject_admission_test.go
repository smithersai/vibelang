package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// A non-finite member disables EK4701. Finite tag kinds retain the check.
func TestMatchSubjectAdmission(t *testing.T) {
	tests := []struct {
		name, source string
		wantError    bool
	}{
		{"number", "function classify(value: number) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"string", "function classify(value: string) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"bigint", "function classify(value: bigint) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"symbol", "function classify(value: symbol) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"unknown", "function classify(value: unknown) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"any", "function classify(value: any) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"object", "function classify(value: object) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"void", "function classify(value: void) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"void-union", "function classify(value: void | true) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"array", "function classify(value: number[]) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"plain-class", "class Plain {}\nfunction classify(value: Plain) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"nonliteral-tag", "function classify(value: { _tag: string }) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"mixed-object", "function classify(value: { _tag: 'A' } | { extra: number }) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"mixed-number", "function classify(value: { _tag: 'A' } | number) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"callable-union", "function classify(value: (() => void) | { _tag: 'A' }) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"branded-primitive", "function classify(value: string & { _tag: 'A' }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"boolean", "function classify(value: boolean) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"literal-union", "function classify(value: 1 | 2) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"null", "function classify(value: null) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"undefined", "function classify(value: undefined) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"enum", "enum Choice { A, B }\nfunction classify(value: Choice) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"string-tag", "function classify(value: { _tag: 'A' }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"number-tag", "function classify(value: { _tag: 1 }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"boolean-tag", "function classify(value: { _tag: false }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"bigint-tag", "function classify(value: { _tag: 1n }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"null-tag", "function classify(value: { _tag: null }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"undefined-tag", "function classify(value: { _tag: undefined }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"optional-tag", "function classify(value: { _tag?: 'A' }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"union-tag", "function classify(value: { _tag: 'A' | 'B' }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"callable-tag", "function classify(value: (() => void) & { _tag: 'A' }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"symbol-tag", "declare const tag: unique symbol\nfunction classify(value: { _tag: typeof tag }) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"generic-open", "function classify<T>(value: T) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"generic-broad", "function classify<T extends string>(value: T) { return match (value) { when let item and if (false): 0; } }\n", false},
		{"generic-literals", "function classify<T extends 'A' | 'B'>(value: T) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"generic-boolean", "function classify<T extends boolean>(value: T) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"generic-tagged", "function classify<T extends { _tag: 'A' } | { _tag: 'B' }>(value: T) { return match (value) { when let item and if (false): 0; } }\n", true},
		{"generic-indirect", "function classify<U extends 1 | 2, T extends U>(value: T) { return match (value) { when let item and if (false): 0; } }\n", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tt.source)
			count := 0
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			for _, d := range all {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == diagnosticSource && d.Code() == EK4701.Code {
					count++
					continue
				}
				t.Errorf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
			}
			if (count != 0) != tt.wantError {
				t.Errorf("EK4701 count %d; want error=%v\n%s", count, tt.wantError, tt.source)
			}
		})
	}
}
