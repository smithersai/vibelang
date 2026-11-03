package ls_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-40: a module name is a lexical binding, and rename edits each written
// identifier specifier. LSP 3.17 makes a rename's edits the symbol's
// references, so find-references at any occurrence returns the same written
// ranges, the declaration only when the client asks for it.
func TestModuleDeclarationReferences(t *testing.T) {
	source := "module text { export const n = 1 }\nmodule other { export const m = 2 }\nimport { n } from text\nimport text\nimport { m } from other\nexport { n as k } from text\nexport const result = n + m\n"
	for _, includeDeclaration := range []bool{true, false} {
		for i := range strings.Count(source, "text") {
			t.Run(fmt.Sprintf("occurrence-%d/declaration-%t", i, includeDeclaration), func(t *testing.T) {
				checkModuleReferences(t, source, "text", i, includeDeclaration)
			})
		}
	}
}

// Generated arrangements of module declarations, specifiers and trivia: from
// any occurrence of a declared module, references are its written names and
// cover every edit rename makes there.
func FuzzModuleDeclarationReferences(f *testing.F) {
	for i := uint8(0); i < 12; i++ {
		f.Add([]byte{i, i * 3, i * 7}, i)
	}
	f.Fuzz(func(t *testing.T, shape []byte, cursor uint8) {
		if len(shape) > 12 {
			return
		}
		trivia := []string{" ", "  ", " /* c */ ", "\t"}
		var b strings.Builder
		b.WriteString("module" + trivia[0] + "text { export const n = 1 }\nmodule other { export const m = 2 }\n")
		for i, s := range shape {
			pad := trivia[int(s>>4)%len(trivia)]
			switch int(s) % 4 {
			case 0:
				fmt.Fprintf(&b, "import { n as n%d } from%stext\n", i, pad)
			case 1:
				fmt.Fprintf(&b, "export { n as e%d } from%stext\n", i, pad)
			case 2:
				fmt.Fprintf(&b, "import { m as m%d } from%sother\n", i, pad)
			case 3:
				fmt.Fprintf(&b, "export { m as f%d } from%sother\n", i, pad)
			}
		}
		b.WriteString("export const result = 1\n")
		source := b.String()
		name := []string{"text", "other"}[int(cursor)%2]
		count := moduleOccurrenceCount(source, name)
		checkModuleReferences(t, source, name, int(cursor/2)%count, cursor%3 != 0)
	})
}

// moduleOccurrenceCount counts whole-word occurrences, which in these
// fixtures are exactly the module's written names.
func moduleOccurrenceCount(source, name string) int {
	return len(moduleOccurrenceOffsets(source, name))
}

func moduleOccurrenceOffsets(source, name string) []int {
	var offsets []int
	word := func(c byte) bool {
		return c == '_' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
	}
	for i := 0; ; {
		j := strings.Index(source[i:], name)
		if j < 0 {
			return offsets
		}
		at := i + j
		end := at + len(name)
		if (at == 0 || !word(source[at-1])) && (end == len(source) || !word(source[end])) {
			offsets = append(offsets, at)
		}
		i = end
	}
}

func checkModuleReferences(t *testing.T, source, name string, occurrence int, includeDeclaration bool) {
	t.Helper()
	offsets := moduleOccurrenceOffsets(source, name)
	service, p, converters := moduleEditorService(t, source)
	file := p.GetSourceFile("/project/main.vibe")
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	position := func(offset int) lsproto.Position {
		pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
		return pos
	}
	at := position(offsets[occurrence])
	response, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: at,
		Context: &lsproto.ReferenceContext{IncludeDeclaration: includeDeclaration},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	if response.Locations != nil {
		for _, location := range *response.Locations {
			if location.Uri != uri {
				t.Fatalf("reference outside the source: %v", location)
			}
			got = append(got, fmt.Sprint(location.Range))
		}
	}
	var want []string
	for i, offset := range offsets {
		if i == 0 && !includeDeclaration {
			continue
		}
		want = append(want, fmt.Sprint(lsproto.Range{Start: position(offset), End: position(offset + len(name))}))
	}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("references of %s at occurrence %d (declaration %t) = %v, want %v\n%s", name, occurrence, includeDeclaration, got, want, source)
	}
	rename, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: at, NewName: "fresh"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rename.WorkspaceEdit == nil || rename.WorkspaceEdit.Changes == nil {
		t.Fatal("rename returned no edits")
	}
	for _, edit := range (*rename.WorkspaceEdit.Changes)[uri] {
		if r := fmt.Sprint(edit.Range); !slices.Contains(want, r) && !(includeDeclaration == false && r == fmt.Sprint(lsproto.Range{Start: position(offsets[0]), End: position(offsets[0] + len(name))})) {
			t.Fatalf("rename edits %v, which references do not return: %v", r, got)
		}
	}
}
