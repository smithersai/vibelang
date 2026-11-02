package vibelang

import "testing"

// A callback's program is checked against the type its call expects only
// where the call fixes that type. A channel that names a type parameter of a
// generic callee is inferred from the callback itself, as TypeScript infers R
// in run(() => program) for run<R>(f: () => Effect<void, never, R>), so the
// callback's requirement is no escape: EK9202 printed "this function needs R,
// but its contract says R = R", two different Rs under one name (t3code's
// managedTunnelStartup retryManagedTunnelRegistration, drive-t3code-server
// slice 4, migration-refusal:generic-requirement-self-mismatch).
func TestGenericCallbackChannelIsNoContract(t *testing.T) {
	prelude := "import { Effect } from \"effect\"\nservice Input { value: number }\n"
	cases := []struct {
		name, source string
		want         int32 // the one VibeLang error expected, or 0
	}{
		{"direct", "const run = <S,>(f: () => void!!S) => f()\nexport const use = <R,>(e: void!never!R) => run(() => e)\n", 0},
		{"member", "const run = <S,>(options: { readonly f: () => void!!S }) => options.f()\nexport const use = <R,>(e: void!never!R) => run({ f: () => e })\n", 0},
		{"optional", "const run = <S,>(options: { readonly f: () => void!!S }) => options.f()\nexport const use = <R,>(e?: void!never!R) => run({ f: () => e ?? Effect.void })\n", 0},
		{"same name", "const run = <R,>(f: () => void!!R) => f()\nexport const use = <R,>(e: void!never!R) => run(() => e)\n", 0},
		{"service", "const run = <S,>(f: () => void!!S) => f()\nexport const use = (e: void!never!Input) => run(() => e)\n", 0},
		{"t3code retry window", "const retry = <A, E, R>(effect: A!E!R, options: { readonly onExhausted: (error: E) => void!!R }) => effect |> Effect.tapError(%, options.onExhausted)\n" +
			"export const retryRegistration = <A, E, R>(registration: A!E!R, onExhausted?: void!never!R) =>\n  retry(registration, { onExhausted: () => onExhausted ?? Effect.void })\n", 0},
		// Controls: a channel the callee fixes is still the callback's contract.
		{"fixed requirement", "const run = (f: () => void!!) => f()\nexport const use = (e: void!never!Input) => run(() => e)\n", EK9202.Code},
		{"fixed error, generic requirement", "const run = <S,>(f: () => void!never!S) => f()\nexport const use = (e: void!Error!never) => run(() => e)\n", EK9201.Code},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prelude+tc.source)
			var got []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource {
					got = append(got, d.Code())
				}
				if d.Code() == EK9201.Code || d.Code() == EK9202.Code || d.Source() != diagnosticSource {
					t.Log(d.String())
				}
			}
			if tc.want == 0 && len(got) != 0 || tc.want != 0 && (len(got) != 1 || got[0] != tc.want) {
				t.Fatalf("VibeLang errors %v, want %v", got, tc.want)
			}
		})
	}
}
