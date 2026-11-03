package vibelang

import "testing"

// A literal passed where the parameter expects only a function that returns an
// Effect took that form from the parameter (D44), so its plain value was its
// success. Its call has no matching overload before the mark (TS2769)
// (Smithers errors TaggedFailures.test.vibe:19).
func TestFixVIPMarksPlainEffectHandler(t *testing.T) {
	boom := "class Boom extends Error {\n  readonly _tag = \"Boom\"\n}\n\n"
	for _, test := range []struct{ name, legacy, want string }{
		{
			"Smithers raise and catchTag",
			boom + "function raise<E>(error: E): Effect<never, E, infer R> {\n  throw error\n}\n\nexport function recover(error: Boom): Effect<string, never, infer R> {\n  return raise(error) |> Effect.catchTag(%, \"Boom\", (caught) => caught.message)\n}\n",
			boom + "effect function raise<E>(error: E): Effect<never, E, infer R> {\n  throw error\n}\n\nexport function recover(error: Boom): Effect<string, never, infer R> {\n  return raise(error) |> Effect.catchTag(%, \"Boom\", effect (caught) => caught.message)\n}\n",
		},
		{
			"template in a data-first call",
			boom + "export const f = (p: number!Boom): string!! => Effect.catchTag(Effect.map(p, String), \"Boom\", (caught) => `b:${caught.message}`)\n",
			boom + "export const f = (p: number!Boom): string!! => Effect.catchTag(Effect.map(p, String), \"Boom\", effect (caught) => `b:${caught.message}`)\n",
		},
		{
			"flatMap",
			"export const f = (p: number!!): number!! => Effect.flatMap(p, (n) => n + 1)\n",
			"export const f = (p: number!!): number!! => Effect.flatMap(p, effect (n) => n + 1)\n",
		},
		{
			"map keeps a plain function",
			"export const f = (p: number!!): number!! => Effect.map(p, (n) => n + 1)\n",
			"export const f = (p: number!!): number!! => Effect.map(p, (n) => n + 1)\n",
		},
		{
			"a handler that returns a program stays",
			"export const f = (p: number!!): number!! => Effect.flatMap(p, (n) => Effect.succeed(n))\n",
			"export const f = (p: number!!): number!! => Effect.flatMap(p, (n) => Effect.succeed(n))\n",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, name := fixVIPOnlySource(t, test.legacy)
			got := test.legacy
			if fixed := result.Files[name]; fixed != nil {
				got = fixed.Text
			}
			if got != test.want || len(result.Refused) != 0 {
				t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, test.want, result.Refused)
			}
		})
	}
}
