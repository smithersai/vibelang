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

// A type alias merged with a module reaches its specifiers through the same
// symbol as rename and references (VIP-40). LSP 3.17 document highlights must
// include these references within the current document.
func TestMergedModuleDeclarationHighlights(t *testing.T) {
	for _, tail := range []string{
		"import { n } from M\n",
		"import M\n",
		"export { n } from M\nimport { n as k } from M\n",
		"import { n } from M\n// unrelated identifier\nconst value = { M: 1 }\n",
	} {
		t.Run(strings.TrimSpace(tail), func(t *testing.T) {
			source := "import type { M } from \"./other.ts\"\nmodule M { export const n = 0 }\n" + tail
			checkMergedModuleHighlights(t, source, 0)
		})
	}
}

func FuzzMergedModuleDeclarationHighlights(f *testing.F) {
	for i := uint8(0); i < 12; i++ {
		f.Add([]byte{i, i * 3, i * 7}, i)
	}
	f.Fuzz(func(t *testing.T, shape []byte, cursor uint8) {
		if len(shape) > 12 {
			return
		}
		var b strings.Builder
		b.WriteString("import type { M } from \"./other.ts\"\nmodule M { export const n = 0 }\n")
		for i, s := range shape {
			pad := []string{" ", "  ", " /* module */ ", "\t"}[(s>>4)%4]
			switch s % 3 {
			case 0:
				fmt.Fprintf(&b, "import { n as n%d } from%sM\n", i, pad)
			case 1:
				fmt.Fprintf(&b, "export { n as e%d } from%sM\n", i, pad)
			case 2:
				fmt.Fprintf(&b, "import%sM\n", pad)
			}
		}
		b.WriteString("const unrelated = { M: 1 }\n")
		source := b.String()
		// Ask from the import alias or module declaration, which the checker merges.
		occurrence := int(cursor) % 2
		checkMergedModuleHighlights(t, source, occurrence)
	})
}

func checkMergedModuleHighlights(t *testing.T, source string, occurrence int) {
	t.Helper()
	service, p, converters := mergedModuleService(t, source)
	file := p.GetSourceFile("/project/main.vibe")
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	offsets := moduleOccurrenceOffsets(source, "M")
	at, _ := converters.ToLSPPosition(file, core.TextPos(offsets[occurrence]))
	refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: at,
		Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	highlights, err := service.ProvideDocumentHighlights(t.Context(), uri, at)
	if err != nil {
		t.Fatal(err)
	}
	var want, got []string
	if refs.Locations != nil {
		var original []string
		for _, r := range *refs.Locations {
			original = append(original, fmt.Sprint(r.Uri, r.Range))
		}
		slices.Sort(original)
		for _, r := range *refs.Locations {
			again, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: r.Uri}, Position: r.Range.Start,
				Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			var found []string
			if again.Locations != nil {
				for _, item := range *again.Locations {
					found = append(found, fmt.Sprint(item.Uri, item.Range))
				}
			}
			slices.Sort(found)
			if !slices.Equal(original, found) {
				t.Fatalf("asymmetric references at %v: got %v want %v", r, found, original)
			}
		}
	}
	if refs.Locations != nil {
		for _, r := range *refs.Locations {
			if r.Uri == uri {
				want = append(want, fmt.Sprint(r.Range))
			}
		}
	}
	if highlights.DocumentHighlights != nil {
		for _, h := range *highlights.DocumentHighlights {
			got = append(got, fmt.Sprint(h.Range))
		}
	}
	slices.Sort(want)
	slices.Sort(got)
	if len(want) < 2 || !slices.Equal(want, got) {
		t.Fatalf("highlight ranges %v, want reference ranges %v\n%s", got, want, source)
	}
	multi, err := service.ProvideMultiDocumentHighlights(t.Context(), uri, at, []lsproto.DocumentUri{uri})
	if err != nil {
		t.Fatal(err)
	}
	got = nil
	if multi.MultiDocumentHighlights != nil {
		for _, document := range *multi.MultiDocumentHighlights {
			if document.Uri == uri {
				for _, h := range document.Highlights {
					got = append(got, fmt.Sprint(h.Range))
				}
			}
		}
	}
	slices.Sort(got)
	if !slices.Equal(want, got) {
		t.Fatalf("multi-document ranges %v, want reference ranges %v", got, want)
	}
}
