package vibelang

import (
	"strings"
	"testing"
)

// The retired placeholder cannot become an input to the returned program's
// generic call. Fixed slots and real callback channels still constrain it.
func TestPlainReturnedEffectInferredContext(t *testing.T) {
	for _, tc := range []struct{ name, prefix, source, placeholder, channel string }{
		{"operand-requirements", "", "export function keep<R>(program: string!!R): string!!infer Need { return program }\n", "infer Need", "R"},
		{"mapped-requirements", "", "export function keep<R>(program: number!!R): string!!infer Need { return Effect.map(program, String) }\n", "infer Need", "R"},
		{"operand-errors", "", "export function keep<E>(program: number!E): number!infer Failure { return program }\n", "infer Failure", "E"},
		{"handler-requirements", "error Gone { id: string }\nservice Users { name: string }\n", "export function recover(program: never!Gone): string!!infer Need { return Effect.catchTag(program, \"Gone\", effect () => { const users = try Users; return users.name }) }\n", "infer Need", "Users"},
		{"handler-errors", "error Gone\nerror Other\n", "export function recover(program: never!Gone): never!infer Failure { return Effect.catchTag(program, \"Gone\", effect () => { throw new Other() }) }\n", "infer Failure", "Other"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := tc.prefix + tc.source
			fixed, name := fixVIPOnlySource(t, source)
			got := source
			if file := fixed.Files[name]; file != nil {
				got = file.Text
			}
			want := strings.ReplaceAll(source, tc.placeholder, tc.channel)
			if got != want || len(fixed.Refused) != 0 || fixed.Err != nil {
				t.Fatalf("repair:\n%s\nwant:\n%s\nrefused %+v; err %v", got, want, fixed.Refused, fixed.Err)
			}
			program, file, _, _ := editorProgram(t, got)
			if diagnostics := program.GetSemanticDiagnostics(t.Context(), file); len(diagnostics) != 0 {
				t.Fatalf("repaired program diagnostics: %v", diagnostics)
			}
		})
	}
}
