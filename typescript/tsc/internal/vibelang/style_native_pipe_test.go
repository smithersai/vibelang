package vibelang

import (
	"testing"
)

// Chapter 900: EK4825 diagnostic - spec-rule: docs/design/src/900-appendices.md#527be10e85136146
func TestStyleKeepsNativePipeStages(t *testing.T) {
	pipeline := "s |> Stream.filter((x) => x > 0)(%) |> Stream.map((x) => x + 1)(%) |> Stream.runCollect(%)"
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"concise-array", "export const probe = effect (s: Stream.Stream<number>) => Array.from(try (" + pipeline + "))", 0},
		{"concise", "export const probe = effect (s: Stream.Stream<number>) => try (" + pipeline + ")", 0},
		{"block-array", "export effect function probe(s: Stream.Stream<number>) { return Array.from(try (" + pipeline + ")) }", 0},
		{"block", "export effect function probe(s: Stream.Stream<number>) { return try (" + pipeline + ") }", 0},
		{"written-chain", "export const probe = (s: Stream.Stream<number>) => s.pipe(Stream.filter((x) => x > 0)).pipe(Stream.map((x) => x + 1))", 1},
		{"written-flat", "export const probe = (s: Stream.Stream<number>) => s.pipe(Stream.filter((x) => x > 0), Stream.map((x) => x + 1))", 0},
		{"written-inside-native", "export const probe = effect (s: Stream.Stream<number>) => try ((s.pipe(Stream.filter((x) => x > 0)).pipe(Stream.map((x) => x + 1))) |> Stream.runCollect(%))", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "// @vibelang-diagnostics EK4825:error\nimport { Stream } from \"effect\"\n" + tc.body
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 4825 {
					count++
				}
				if d.Code() == 2307 {
					t.Fatal(d.String())
				}
			}
			if count != tc.want {
				t.Errorf("got %d EK4825, want %d: %s", count, tc.want, source)
			}
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				t.Errorf("syntax: %s", d.String())
			}
		})
	}
}
