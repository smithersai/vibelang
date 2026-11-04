package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// TypeScript's ordinary members are writable unless readonly (chapter 001).
// The migration removes only the contextual token, keeping comments and names.
func TestFixMutableRelic(t *testing.T) {
	cases := []struct{ name, source, want string }{
		{"interface", "export interface I { mutable x: number; readonly y: string }", "export interface I { x: number; readonly y: string }"},
		{"index", "export interface I { mutable [mutable: string]: number }", "export interface I { [mutable: string]: number }"},
		{"object", "export type I = { mutable x?: number; nested: { mutable y: string } }", "export type I = { x?: number; nested: { y: string } }"},
		{"computed", "declare const key: unique symbol; export interface I { mutable [key]?: number }", "declare const key: unique symbol; export interface I { [key]?: number }"},
		{"trivia", "export interface I { /* before */ mutable /* keep */ x: number; mutable\t'word': number }", "export interface I { /* before */ /* keep */ x: number; 'word': number }"},
		{"jsdoc", "export interface I {\nmutable /** docs */ x: number\n}", "export interface I {\n x: number\n}\n;\n/** docs */;\n"},
		{"index-jsdoc", "export interface I {\nmutable /** docs */ [key: string]: number\n}", "export interface I {\n [key: string]: number\n}\n;\n/** docs */;\n"},
		{"identifier", "export interface I { mutable: number; mutable?: string; mutable(): number }", ""},
		{"literal", "export const text = 'mutable x'; // mutable x\nexport type I = { mutable: number }", ""},
		{"custom", "schema S { mutable x: number }; data D { V { mutable x: number } }; schema error SE { mutable x: number }", ""},
	}
	for _, tc := range cases {
		for _, migration := range []bool{false, true} {
			t.Run(tc.name+map[bool]string{false: "/ordinary", true: "/migration"}[migration], func(t *testing.T) {
				p, file, _, _ := editorProgram(t, tc.source)
				options := FixOptions{MigrationOnly: migration}
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
				fixed := result.Files[file.FileName()]
				if tc.want == "" {
					if fixed != nil && fixed.Text != tc.source {
						t.Fatalf("changed excluded source: %s", fixed.Text)
					}
					return
				}
				if result.Err != nil || fixed == nil || fixed.Text != tc.want || len(result.Refused) != 0 {
					t.Fatalf("want %s; result %+v; fixed %+v", tc.want, result, fixed)
				}
				if strings.Contains(fixed.Text, "mutable x") {
					t.Fatal("modifier remains")
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
				if len(again.Files) != 0 || again.Err != nil {
					t.Fatalf("not idempotent: %+v", again)
				}
			})
		}
	}
}
