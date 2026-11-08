package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// D501: a migrated library's public declarations stay what its TypeScript
// declared. Every .vibe module has a declaration, its sidecar (007), and a
// package's types can name it, so noEmit and declaration: false change
// nothing: an exported Schema.Struct constant with no type of its name keeps
// its constant, because schema X { … } would add type X to the sidecar.
// opencode's protocol package is noEmit through @tsconfig/bun and publishes
// its sidecars; --fix turned SessionMediaMessageResponse, a value-only codec,
// into a schema declaration that also exported a type.
func TestSchemaConstantKeepsSidecarDeclarations(t *testing.T) {
	source := `export const SessionMediaMessageResponse = Schema.Struct({ data: Schema.String })

export const Pair = Schema.Struct({ left: Schema.Number })
export type Pair = typeof Pair.Type
`
	want := `export const SessionMediaMessageResponse = Schema.Struct({ data: Schema.String })

export schema Pair { readonly left: number }
`
	for _, options := range []string{`"noEmit":true`, `"declaration":false`} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,`+options+`},"files":["main.vibe"]}`), 0o600); err != nil {
			t.Fatal(err)
		}
		result := fixCase(t, dir)
		got := source
		if fixed := result.Files[file.FileName()]; fixed != nil {
			got = fixed.Text
		}
		if got != want || len(result.Refused) != 0 {
			t.Errorf("%s: --fix wrote\n%s\nwant\n%s\nrefused %+v", options, got, want, result.Refused)
		}
		if strings.Contains(got, "schema SessionMediaMessageResponse") {
			t.Errorf("%s: the value-only codec gained a type", options)
		}
	}
}

// The other --fix guards that keep a published declaration's spelling apply
// in a noEmit project too, for the same reason: the sidecar is its
// declaration. Each source keeps its written form after --fix.
func TestFormFixesKeepSidecarSpellingWithoutEmit(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		// tsforms_schemas.go: Schema.Schema.Type<typeof X> is not the alias
		// the declaration writes, so the pair stays.
		{"schema own type spelled with the helper", "export const Pair = Schema.Struct({ left: Schema.Number })\nexport type Pair = Schema.Schema.Type<typeof Pair>\n", ""},
		// tsforms_errors.go: an error declaration drops a written <{}>.
		{"fieldless error with an empty payload argument", "export class Missing extends Data.TaggedError(\"Missing\")<{}> {}\n", ""},
		// tsforms_errors.go: the declaration file would print Schema.TaggedError.
		{"schema error under another spelling", "import { Schema as S } from \"effect\"\nexport class Failed extends S.TaggedError<Failed>()(\"Failed\", { reason: S.String }) {}\n", ""},
		// tsforms_types.go: an exported signature keeps its never slots.
		{"exported Effect type keeps its never slots", "export const one = (): Effect.Effect<number, never, never> => Effect.succeed(1)\n", "export const one = (): number!never!never => Effect.succeed(1)\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			got := tc.source
			if fixed := result.Files[file.FileName()]; fixed != nil {
				got = fixed.Text
			}
			want := tc.want
			if want == "" {
				want = tc.source
			}
			if got != want {
				t.Errorf("--fix wrote\n%s\nwant\n%s", got, want)
			}
		})
	}
}
