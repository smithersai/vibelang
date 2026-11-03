package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const domTypeOnlyQuote = "In a type position, a bare name declared as a type by an ambient global declaration (a TypeScript `lib` file or `@types`) keeps that meaning"
const domTypeOnlyNamespaceQuote = "These namespaces come in scope with the precedence above, so a subpath namespace whose name is a web platform global names Effect's."

func TestPreludeDOMTypeOnlyQuoted(t *testing.T) {
	for _, quote := range []string{domTypeOnlyQuote, domTypeOnlyNamespaceQuote} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}

// Each input compares the compiler on the VibeLang form and its explicit
// TypeScript import twin, which VIP-14 says have the same meaning. The
// variants cover bare host types, typeof queries, namespace types and local
// value shadows. No runtime behavior is inferred from a successful compile.
func FuzzPreludeDOMTypeOnly(f *testing.F) {
	startShortBudget(f)
	names := []string{"KeyFormat", "Transferable"}
	forms := []string{"value", "namespace", "shadow"}
	for _, name := range names {
		for _, form := range forms {
			f.Add([]byte(name + ":" + form))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestPreludeDOMTypeOnlyQuoted(t)
		parts := strings.Split(string(data), ":")
		name, form := names[0], forms[0]
		if len(parts) > 0 && slices.Contains(names, parts[0]) {
			name = parts[0]
		} else if len(data) > 0 {
			name = names[int(data[0])%len(names)]
		}
		if len(parts) > 1 && slices.Contains(forms, parts[1]) {
			form = parts[1]
		} else if len(data) > 1 {
			form = forms[int(data[1])%len(forms)]
		}
		subpath, member, namespaceType := "effect/crypto/KeyFormat", "pem", "Format<\"public\", \"decode\", Uint8Array>"
		if name == "Transferable" {
			subpath, member, namespaceType = "effect/workers/Transferable", "Collector", "Collector"
		}
		body := fmt.Sprintf("export type Host = %s;\nexport const member = %s.%s;\nconst forward: typeof Native.%s = member;\nconst reverse: typeof member = Native.%s;\n", name, name, member, member, member)
		if form == "namespace" {
			body += fmt.Sprintf("export type NamespaceType = %s.%s;\n", name, namespaceType)
		}
		if form == "shadow" {
			body = fmt.Sprintf("const %s = { marker: 1 as const };\nexport type Host = %s;\nexport const marker: 1 = %s.marker;\n", name, name, name)
		}
		imports := fmt.Sprintf("import * as Native from %q;\n", subpath)
		g := &Gaps{Target: "FuzzPreludeDOMTypeOnly"}
		for _, native := range []bool{true, false} {
			source, file := imports+body, "main.vibe"
			if native {
				file = "main.ts"
				if form != "shadow" {
					source = imports + fmt.Sprintf("import * as %s from %q;\n", name+"$", subpath) + strings.ReplaceAll(body, name+".", name+"$.")
				}
			}
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if native {
					t.Fatalf("invalid TypeScript twin: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				g.Add(name+":"+form, "VIP-14: %q; %q; diagnostics %v\n%s", domTypeOnlyQuote, domTypeOnlyNamespaceQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
