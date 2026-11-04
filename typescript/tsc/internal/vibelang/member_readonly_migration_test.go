package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-15 / 005-services, Member readonlyness: only schema fields (including
// the fields of a nested struct in a schema-error payload) and service shape
// properties, plus nested error/data members, had readonly defaults to preserve.
func TestMemberReadonlyMigrationRule(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"export interface I { value: { nested: number } }", "export interface I { value: { nested: number } }"},
		{"export type T = { value: { nested: number } }", "export type T = { value: { nested: number } }"},
		{"export class C { value!: { nested: number } }", "export class C { value!: { nested: number } }"},
		{"export error E { value: { nested: number } }", "export error E { value: { readonly nested: number } }"},
		{"export schema error E { value: number }", "export schema error E { value: number }"},
		{"export schema error E { value: { nested: number } }", "export schema error E { value: { readonly nested: number } }"},
		{"export data D { V { value: { nested: number } } }", "export data D { V { value: { readonly nested: number } } }"},
		{"export schema S { value: { nested: number }; readonly fixed: string }", "export schema S { readonly value: { readonly nested: number }; readonly fixed: string }"},
		{"export service S { value: { nested: number }; run(): number; readonly fixed: string }", "export service S { readonly value: { readonly nested: number }; run(): number; readonly fixed: string }"},
		{"service S: { value: { nested: number }; run(input: { n: number }): number } {}", "service S: { readonly value: { readonly nested: number }; run(input: { readonly n: number }): number } {}"},
		{"service S { static config: { n: number }; run(input: { n: number }): { n: number } }", "service S { static config: { readonly n: number }; run(input: { readonly n: number }): { readonly n: number } }"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			got := sourceFileMigrationFixes(t.Context(), p, file, map[string]bool{}).text()
			if got != tc.want {
				t.Fatalf("member rule:\ngot %s\nwant %s", got, tc.want)
			}
		})
	}
}

// Minimized from foldkit-174 ref42b: a data value is not a schema. The
// readonly insertion must not be refused because of the pre-existing error.
func TestMemberReadonlyMigrationInvalidCodec(t *testing.T) {
	source := "export data Drag { Idle; Moving { x: number } }\nexport schema S { drag: Drag; n: number }\nexport const n = S.fields.n\nexport const get = (s: S) => s.n\n"
	p, file, _, _ := editorProgram(t, source)
	p.CommandLine().CompilerOptions().NoPropertyAccessFromIndexSignature = core.TSTrue
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("safe insertion refused: %+v", result)
	}
	next := result.Files[file.FileName()]
	if next == nil || result.LegacyReadonlyFields != 2 || !strings.Contains(next.Text, "readonly drag: Drag; readonly n: number") {
		t.Fatalf("missing schema fields: %+v", next)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(next.Text), 0600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("not idempotent: %+v", again)
	}
}

func FuzzMemberReadonlyMigrationRule(f *testing.F) {
	for kind := uint8(0); kind < 14; kind++ {
		for flags := uint8(0); flags < 4; flags++ {
			f.Add(kind, flags)
		}
	}
	f.Fuzz(func(t *testing.T, kind, flags uint8) {
		name := "value"
		if flags&2 != 0 {
			name = "café"
		}
		mod := ""
		if flags&1 != 0 {
			mod = "readonly "
		}
		member := mod + name + ": number"
		var source, want string
		// An independent table, not the migration's AST predicates, is the oracle.
		switch kind % 14 {
		case 0:
			source = "schema S { " + member + " }"
			want = "schema S { readonly " + name + ": number }"
		case 1:
			source = "service S { " + member + " }"
			want = "service S { readonly " + name + ": number }"
		case 2:
			source = "interface I { " + member + " }"
		case 3:
			source = "type T = { " + member + " }"
		case 4:
			source = "class C { " + member + " }"
		case 5:
			source = "error E { " + member + " }"
		case 6:
			source = "schema error E { " + member + " }"
		case 7:
			source = "data D { V { " + member + " } }"
		case 8:
			// An inline service shape: its own properties had the default.
			source = "service S: { " + member + " } {}"
			want = "service S: { readonly " + name + ": number } {}"
		case 9:
			// A legacy service property preserves its nested pre-pin readonly API.
			source = "service S { value: { " + member + " } }"
			want = "service S { readonly value: { readonly " + name + ": number } }"
		case 10:
			// A nested object in a schema is a schema struct: its fields had the default too.
			source = "schema S { value: { " + member + " } }"
			want = "schema S { readonly value: { readonly " + name + ": number } }"
		case 11:
			// A schema-error payload field is readonly already; its nested struct is a schema.
			source = "schema error E { value: { " + member + " } }"
			want = "schema error E { value: { readonly " + name + ": number } }"
		case 12:
			// Plain error readonlyness is shallow; migration retains the pre-pin nested declaration.
			source = "error E { value: { " + member + " } }"
			want = "error E { value: { readonly " + name + ": number } }"
		case 13:
			// Data fields are already readonly; only their nested members need modifiers.
			source = "data D { V { value: { " + member + " } } }"
			want = "data D { V { value: { readonly " + name + ": number } } }"
		}
		if want == "" {
			want = source
		}
		p, file, _, _ := editorProgram(t, source)
		got := sourceFileMigrationFixes(t.Context(), p, file, map[string]bool{}).text()
		if got != want {
			t.Fatalf("kind=%d flags=%d: got %s; want %s", kind, flags, got, want)
		}
	})
}
