package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

const scalarRenameTarget = "FuzzSchemaScalarBindingRename"
const scalarRenameQuote = "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do. A shadowing declaration supplies no schema."

func TestSchemaScalarBindingRenameQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0044-durable-values.md"), scalarRenameQuote) {
		t.Fatal("VIP-44 scalar binding rule changed")
	}
	if !strings.Contains(SpecText("000-intro.md"), "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.") {
		t.Fatal("TypeScript counterpart rule changed")
	}
}

// A local import alias has the same two occurrences before and after codec
// selection. Renaming either occurrence must update both and preserve checking.
func FuzzSchemaScalarBindingRename(f *testing.F) {
	startShortBudget(f)
	names := []string{"Date", "URL", "RegExp", "Uint8Array", "Error"}
	for _, name := range names {
		f.Add(name, uint8(0), uint8(0), false)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, syntax, shape uint8, alias bool) {
		TestSchemaScalarBindingRenameQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		name := names[int(key[0])%len(names)]
		for _, n := range names {
			if key == n {
				name = n
			}
		}
		binding, field := "Native", "Native"
		prefix := "import type {Library as Native} from './types.js'; "
		switch syntax % 4 {
		case 1:
			prefix = "import {type Library as Native} from './types.js'; "
		case 2:
			binding, field = "Types", "Types.Library"
			prefix = "import type * as Types from './types.js'; "
		case 3:
			binding, field = "Library", "Library"
			prefix = "import type {Library} from './types.js'; "
		}
		if syntax&4 != 0 && binding == "Native" {
			prefix = strings.ReplaceAll(prefix, "Native", "Date")
			field, binding = "Date", "Date"
		}
		switch shape % 4 {
		case 1:
			field = "readonly " + field + "[]"
		case 2:
			field = "ReadonlyMap<" + field + ",number>"
		case 3:
			field = "readonly [" + field + "]"
		}
		body := "export schema Example {readonly value:" + field + "}"
		if alias {
			body = "export schema Example=" + field
		}
		source := prefix + body
		files := map[string]string{"main.vibe": source, "types.ts": "import Library=globalThis." + name + ";export {Library};"}
		r := toolsCompile(t, w, scalarRenameTarget, files)
		defer r.Remove()
		if HasError(r.Diagnostics) {
			t.Fatalf("invalid scalar spelling: %v\n%s", Keys(r.Dir, r.Diagnostics), Archive(files))
		}
		c := &consistency{t: t, ctx: t.Context(), w: w, main: "main.vibe", archive: Archive(files)}
		p := c.project(r, files)
		c.before = p
		declaration, use := strings.Index(source, binding), strings.LastIndex(source, binding)
		for _, offset := range []int{declaration, use} {
			refs, ok := c.references(p, c.main, offset)
			if !ok {
				return
			}
			key := fmt.Sprintf("%s/%d/%s/%d/%t/%d", name, syntax%4, binding, shape%4, alias, offset)
			for _, expected := range []int{declaration, use} {
				if !refs[consistencySpan{c.main, expected, expected + len(binding)}] {
					Gap(t, scalarRenameTarget, key+"/references", scalarRenameQuote+"; lost source import alias occurrence at %d\n%s", expected, Archive(files))
					return
				}
			}
			uri := p.uri(c.main)
			rename, ok := consistencyRequest(c, p, "rename", uri, func(s *ls.LanguageService) (lsproto.RenameResponse, error) {
				return s.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: p.position(c.main, offset), NewName: "Renamed"}, nil)
			})
			if !ok {
				return
			}
			if rename.WorkspaceEdit == nil {
				Gap(t, scalarRenameTarget, key+"/rename", scalarRenameQuote+"; missing rename\n%s", Archive(files))
				return
			}
			edited, ok := c.apply(p, "scalar alias rename", key, "Renamed", rename.WorkspaceEdit)
			if !ok {
				return
			}
			wanted := strings.ReplaceAll(source, binding, "Renamed")
			if syntax%4 == 3 {
				wanted = strings.Replace(wanted, "{Renamed}", "{Library as Renamed}", 1)
			}
			if edited.files[c.main] != wanted {
				Gap(t, scalarRenameTarget, key+"/rename", scalarRenameQuote+"; rename did not preserve both source occurrences\n%s", Archive(edited.files))
				return
			}
			after := toolsCompile(t, w, scalarRenameTarget, edited.files)
			defer after.Remove()
			if HasError(after.Diagnostics) {
				Gap(t, scalarRenameTarget, key+"/checking", scalarRenameQuote+"; renamed source stopped checking: %v\n%s", Keys(after.Dir, after.Diagnostics), Archive(edited.files))
				return
			}
		}
	})
}
