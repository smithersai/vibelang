package vibelangfuzz

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const migrationMutabilityTarget = "FuzzMigrationMutability"
const migrationMutabilityQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
const migrationMutabilityPropertiesQuote = "Ordinary interface and object-type properties, including optional members and index signatures, keep exactly the source's written `readonly` modifiers, including in nested object types; class fields keep their written modifiers too."

func TestMigrationMutabilityQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"000-intro.md":     migrationMutabilityQuote,
		"001-functions.md": migrationMutabilityPropertiesQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// Foldkit-10's plain TypeScript pattern expands to nearby declaration forms.
// Written readonly controls must still reject mutation; shallow readonly must
// leave nested arrays writable. No expected result is copied from VibeLang.
func migrationMutabilitySeeds() []string {
	var sources []string
	for _, modifier := range []string{"", "readonly "} {
		for _, source := range []string{
			"export function widen(options: { " + modifier + "minimum: number }): void { options.minimum = 0 }",
			"export interface Options { " + modifier + "minimum: number }; export function widen(options: Options): void { options.minimum = 0 }",
			"export type Options = { " + modifier + "minimum?: number }; export const widen = (options: Options): void => { options.minimum = 0 }",
			"export function widen(options: { nested: { " + modifier + "minimum: number } }): void { options.nested.minimum = 0 }",
			"export function widen(options: { " + modifier + "[key: string]: number }): void { options.minimum = 0 }",
		} {
			sources = append(sources, source+"\n")
		}
	}
	sources = append(sources,
		"export function append(options: { readonly values: number[] }): void { options.values.push(0) }\n",
		"export function widen(options: [number, number]): void { options[0] = 0 }\n",
		"export class Box { value = 1; write(): void { this.value = 0 } }\n",
		"declare const key: unique symbol; export function widen(options: { [key]: number }): void { options[key] = 0 }\n")
	return sources
}

func mutabilityDiagnostic(d *ast.Diagnostic) bool {
	return !IsEK(d) && (d.Code() == 2540 || d.Code() == 2542)
}

func migrationMutabilityDiagnostics(r *Result) []string {
	var keys []string
	for _, d := range r.Diagnostics {
		if !mutabilityDiagnostic(d) {
			continue
		}
		name := strings.TrimPrefix(filepath.ToSlash(d.File().FileName().AsString()), filepath.ToSlash(r.Dir)+"/")
		if stem, ok := strings.CutSuffix(name, ".vibe"); ok {
			name = stem + ".ts"
		}
		keys = append(keys, fmt.Sprintf("%s:%d:%d:TS%d", name, d.Pos(), d.End(), d.Code()))
	}
	slices.Sort(keys)
	return keys
}

// The specification says these two inputs agree: identical ordinary
// TypeScript text, checked as .ts and renamed to .vibe. Only readonly mutation
// diagnostics are compared; the known exceptions for platform access, throws
// and contextual syntax do not supply oracles about unrelated diagnostics.
func checkMigrationMutability(t *testing.T, w *Workspace, archive string) {
	t.Helper()
	TestMigrationMutabilityQuoted(t)
	toolsGuard(t, migrationMutabilityTarget, func() {
		stock, vibe, reason := declarationIdentityProjects(archive)
		if reason != "" {
			t.Skip(reason)
		}
		var before, after *Result
		var err error
		within(t, "compile TypeScript", func() { before, err = w.Compile(t.Context(), stock) })
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		for _, d := range before.Diagnostics {
			if d.Category() == diagnostics.CategoryError && !mutabilityDiagnostic(d) {
				t.Skip("not a valid TypeScript mutability witness")
			}
		}
		within(t, "compile VibeLang", func() { after, err = w.Compile(t.Context(), vibe) })
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		expected, actual := migrationMutabilityDiagnostics(before), migrationMutabilityDiagnostics(after)
		if !slices.Equal(expected, actual) {
			Gap(t, migrationMutabilityTarget, fmt.Sprintf("mutability:%x", sha256.Sum256([]byte(archive))),
				"Chapter 0: %q; Chapter 1: %q\n.ts readonly diagnostics: %v\n.vibe readonly diagnostics: %v\n%s",
				migrationMutabilityQuote, migrationMutabilityPropertiesQuote, expected, actual, archive)
		}
		ExpectPending(t, migrationMutabilityTarget, fmt.Sprintf("mutability:%x", sha256.Sum256([]byte(archive))))
		ExpectPending(t, migrationMutabilityTarget, specCorpusKey(t))
	})
}

func FuzzMigrationMutability(f *testing.F) {
	startShortBudget(f)
	seeds := migrationMutabilitySeeds()
	for _, source := range seeds {
		f.Add(Archive(map[string]string{"main.ts": source}))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, archive string) { checkMigrationMutability(t, w, archive) })
}
