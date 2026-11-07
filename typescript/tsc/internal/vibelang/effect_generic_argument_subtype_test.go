package vibelang

import "testing"

func TestEffectSubtypeIntoPlainGeneric(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         int
	}{
		{"command-pipe", `import { Command } from "effect/cli"
export effect function main() { return Command.make("repro").pipe(Command.withDescription("A command.")).name }`, 0},
		{"command-data", `import { Command } from "effect/cli"
function keep<T>(value: T): { value: T } { return { value } }
export effect function main() { return keep(Command.make("repro")).value.name }`, 0},
		{"user-subtype", `interface Descriptor extends Effect.Effect<number> { readonly label: string }
function keep<T>(value: T): { value: T } { return { value } }
export effect function main(value: Descriptor) { return keep(value).value.label }`, 0},
		{"subtype-alias", `interface Descriptor extends Effect.Effect<number> { readonly label: string }
type Alias = Descriptor
function keep<T>(value: T): { value: T } { return { value } }
export effect function main(value: Alias) { return keep(value).value.label }`, 0},
		{"subtype-union", `interface Descriptor extends Effect.Effect<number> { readonly label: string }
interface Other extends Effect.Effect<number> { readonly name: string }
function keep<T>(value: T): { value: T } { return { value } }
export effect function main(value: Descriptor | Other) { return keep(value).value }`, 0},
		{"effect-alias", `type Program = Effect.Effect<number>
function keep<T>(value: T): { value: T } { return { value } }
export effect function main(value: Program) { return keep(value).value }`, 1},
		{"effect-union", `function keep<T>(value: T): { value: T } { return { value } }
export effect function main(value: Effect.Effect<number> | Effect.Effect<string>) { return keep(value).value }`, 1},
		{"receiver-callback-result", `export effect function main() { const held = Stream.make(1).pipe(Stream.runCollect); return 0 }`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4802.Code {
					count++
				}
			}
			if count != test.want {
				t.Fatalf("got %d inferred-Effect diagnostics, want %d\n%s", count, test.want, test.source)
			}
		})
	}
}
