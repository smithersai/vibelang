package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzDataCounterpart enforces docs/design/src/001-functions.md, Declaration
// output: dataCounterpartQuote. Chapter 6 gives the counterpart of
// data Name { Variant { fields } }: dataCounterpartChapterQuote. Each input
// generates an exported data declaration and that counterpart, written out
// independently of the compiler, and the migration identity gate must find
// their declaration files API-identical when export documentation matches. A
// documentation mutation must instead produce only a doc-comment difference.
// This compares the compiler with itself on
// two inputs the spec says declare the same API (foldkit-16: html/lazy's
// LazyMissReason declared its constant first, as Constructor<LazyMissReason>,
// and its fields readonly).
func FuzzDataCounterpart(f *testing.F) {
	startShortBudget(f)
	api := declarationIdentityAPI(f)
	w := NewWorkspace(f)
	for _, seed := range dataCounterpartSeeds() {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		checkDataCounterpart(t, w, api, generateDataCounterpart(input))
	})
}

const (
	dataCounterpartQuote        = "A `service`, `error`, `schema`, `schema error` or `data` declaration is declared as TypeScript's declaration emit of its Effect TypeScript counterpart"
	dataCounterpartChapterQuote = "type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string }; Rejected: { reason: string } }>\nconst Delivery = Data.taggedEnum<Delivery>()"
)

// TestDataCounterpartQuoted runs in the gate (specTests in the root
// PACKAGE.ts), so a chapter edit that rewords a quoted rule updates the
// quote in the same change.
func TestDataCounterpartQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), dataCounterpartQuote) {
		t.Errorf("chapter 001-functions.md no longer says %q; update the quote", dataCounterpartQuote)
	}
	if !strings.Contains(SpecText("006-data.md"), dataCounterpartChapterQuote) {
		t.Errorf("chapter 006-data.md no longer gives the counterpart %q; update the quote", dataCounterpartChapterQuote)
	}
}

// A dataCounterpart is one exported data declaration in both spellings.
type dataCounterpart struct {
	vibe, typescript string
	differentDoc     string // nonempty only for a deliberate export-documentation mutation.
}

// dataCounterpartSeeds are inputs that generateDataCounterpart reads byte by
// byte; testdata/fuzz/FuzzDataCounterpart holds the minimized foldkit one.
func dataCounterpartSeeds() [][]byte {
	return [][]byte{
		{},                                  // one variant, no fields
		[]byte("key:export-doc-mutation\n"), // a changed constructor comment must fail API identity
		{1, 1, 0, 2, 0, 1, 1, 3},            // a JSDoc, an empty variant, fields written readonly and plain
		{0, 2, 2, 4, 0, 5, 2, 0, 0},         // recursion through the type and a Record, an optional field
		{1, 3, 3, 3, 3, 6, 2, 7, 1, 1, 0},   // four variants, readonly optional, a union with undefined, a tuple
		{0, 0, 3, 1, 1, 2, 3, 0, 0, 1, 0},
	}
}

// generateDataCounterpart reads input as choices, each byte modulo its
// range, with 0 once input runs out: whether the declaration has a JSDoc,
// how many variants, and for each variant its fields, each with or without a
// written readonly or a ?, and its type, which may name the data type itself.
// A generic one's helper interface is named apart from chapter 6's
// $Name$Definition today, so the data-declaration-counterpart case covers
// its order instead.
func generateDataCounterpart(input []byte) dataCounterpart {
	// Preserve every legacy byte choice; the new negative control has a stable key.
	docInput, docMutation := strings.CutPrefix(string(input), "key:export-doc-mutation\n")
	if docMutation {
		input = []byte(docInput)
	}
	i := 0
	next := func(n int) int {
		if i >= len(input) {
			return 0
		}
		i++
		return int(input[i-1]) % n
	}
	doc := next(2) == 1
	names := []string{"Waiting", "Sent", "Rejected", "Retried"}
	fieldNames := []string{"tracking", "reason", "count", "note"}
	types := []string{"string", "number", "boolean", "ReadonlyArray<string>", "Item", "Record<string, Item>", "string | undefined", "readonly [number, string]"}
	variants := 1 + next(4)
	var vibeVariants, tsVariants []string
	for v := range variants {
		var fields []string
		for f := range next(4) {
			t := types[next(len(types))]
			modifiers := next(4)
			field := fieldNames[f]
			if modifiers&1 != 0 {
				field = "readonly " + field
			}
			if modifiers&2 != 0 {
				field += "?"
			}
			fields = append(fields, field+": "+t)
		}
		body := "{ " + strings.Join(fields, "; ") + " }"
		if len(fields) == 0 {
			body = "{}"
			vibeVariants = append(vibeVariants, names[v])
		} else {
			vibeVariants = append(vibeVariants, names[v]+" "+body)
		}
		tsVariants = append(tsVariants, names[v]+": "+body)
	}
	comment := ""
	if doc {
		comment = "/** An item. */\n"
	}
	vibe := comment + "export data Item {\n  " + strings.Join(vibeVariants, "\n  ") + "\n}\n"
	valueComment, differentDoc := comment, ""
	if docMutation {
		differentDoc = "Changed constructor documentation."
		valueComment = "/** " + differentDoc + " */\n"
	}
	ts := `import { Data } from "effect"` + "\n" + comment + "export type Item = Data.TaggedEnum<{ " + strings.Join(tsVariants, "; ") + " }>\n" +
		valueComment + "export const Item = Data.taggedEnum<Item>()\n"
	return dataCounterpart{vibe: vibe, typescript: ts, differentDoc: differentDoc}
}

func checkDataCounterpart(t *testing.T, w *Workspace, api string, c dataCounterpart) {
	t.Helper()
	declarationsOf := func(name, text string) (string, bool) {
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{name: text}})
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				return specDiagnosticText(d), false
			}
		}
		return r.Outputs["out/main.d.ts"], true
	}
	reference, ok := declarationsOf("main.ts", c.typescript)
	if !ok {
		t.Skipf("the counterpart is not valid Effect TypeScript: %s\n%s", reference, c.typescript)
	}
	declared, ok := declarationsOf("main.vibe", c.vibe)
	if !ok {
		Gap(t, "FuzzDataCounterpart", "data-compiles", "the data declaration does not compile: %s\n%s", declared, c.vibe)
		return
	}
	before, after := filepath.Join(t.TempDir(), "typescript"), filepath.Join(t.TempDir(), "vibelang")
	for dir, text := range map[string]string{before: reference, after: declared} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "main.d.ts"), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	diff, err := compareIdentityDeclarations(t.Context(), api, before, after)
	if err != nil {
		t.Fatal(err)
	}
	if c.differentDoc != "" {
		if !strings.Contains(diff, "Doc-comment differences:") || !strings.Contains(diff, c.differentDoc) ||
			!strings.Contains(diff, "Name differences:\n  (none)") || !strings.Contains(diff, "Type differences:\n  (none)") {
			Gap(t, "FuzzDataCounterpart", "export-doc-mutation", "changed constructor documentation must produce only a doc-comment difference:\n%s", diff)
		}
		return
	}
	if diff != "" {
		Gap(t, "FuzzDataCounterpart", "data-declaration-counterpart", "%s\n\n%s\n%s\nTypeScript declares:\n%s\nVibeLang declares:\n%s",
			diff, c.vibe, c.typescript, reference, declared)
	}
}

// TestDataCounterpartFoldkit is html/lazy's declaration, minimized
// (testdata/fuzz/FuzzDataCounterpart/foldkit-lazy-miss-reason holds the same
// shape as fuzz input): its TypeScript wraps the payload in Readonly<{ … }>,
// which the identity gate reads as the fields the .vibe writes readonly.
func TestDataCounterpartFoldkit(t *testing.T) {
	api := declarationIdentityAPI(t)
	w := NewWorkspace(t)
	c := dataCounterpart{
		vibe: "/** Why a lazy call ran its view instead of reusing the cached result. */\nexport data LazyMissReason {\n  NoCachedEntry\n  ArgumentCountChanged { readonly previousCount: number; readonly currentCount: number }\n}\n",
		typescript: `import { Data } from "effect"
/** Why a lazy call ran its view instead of reusing the cached result. */
export type LazyMissReason = Data.TaggedEnum<{
  NoCachedEntry: {}
  ArgumentCountChanged: Readonly<{ previousCount: number; currentCount: number }>
}>
/** Why a lazy call ran its view instead of reusing the cached result. */
export const LazyMissReason = Data.taggedEnum<LazyMissReason>()
`,
	}
	t.Run("matching export documentation", func(t *testing.T) {
		checkDataCounterpart(t, w, api, c)
	})
	t.Run("original changed constructor documentation is rejected", func(t *testing.T) {
		c.differentDoc = "@internal Constructors and matching for lazy cache miss reasons."
		c.typescript = strings.Replace(c.typescript,
			"/** Why a lazy call ran its view instead of reusing the cached result. */\nexport const",
			"/** "+c.differentDoc+" */\nexport const", 1)
		checkDataCounterpart(t, w, api, c)
	})
}
