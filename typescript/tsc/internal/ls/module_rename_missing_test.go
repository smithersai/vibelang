package ls_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A missing name is a parser recovery node, not a written module occurrence.
// Both prepareRename and rename must still answer for other bindings.
func TestModuleRenameMissingName(t *testing.T) {
	for _, trivia := range []string{" ", "\t", " /* missing name */ ", " /* comment\ncontinued */ "} {
		for _, name := range []string{"result", "text"} {
			t.Run(name+"/"+trivia, func(t *testing.T) {
				checkRenameBesideMissingModule(t, trivia, name)
			})
		}
	}
}

func checkRenameBesideMissingModule(t *testing.T, trivia, name string) {
	t.Helper()
	prefix := "module" + trivia + "{ export const n = 1 }\n"
	valid := "module text { export const n = 2 }\nimport { n } from text\nexport const result = n\nexport const read = result\n"
	source := prefix + valid
	replacement := "fresh_" + name
	service, p, converters := moduleEditorService(t, source)
	file := p.GetSourceFile("/project/main.vibe")
	start := len(prefix) + strings.Index(valid, name)
	pos, _ := converters.ToLSPPosition(file, core.TextPos(start))
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	if info := service.GetRenameInfo(t.Context(), replacement, uri, pos); !info.CanRename {
		t.Fatal("prepareRename refused the written binding beside an incomplete module")
	}
	response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: replacement,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
		t.Fatal("rename returned no edits")
	}
	changes := *response.WorkspaceEdit.Changes
	if len(changes) != 1 {
		t.Fatalf("rename edited documents outside the source: %v", changes)
	}
	want := prefix + strings.ReplaceAll(valid, name, replacement)
	if got := applyModuleEdits(source, changes[uri]); got != want {
		t.Fatalf("rename = %q, want %q", got, want)
	}
}

// VIP-40: "renaming parse renames identifier specifiers only".
// Mutate trivia before a missing name and rename either an unrelated local
// or a valid module beside it: parser recovery must not supply an occurrence.
func FuzzRenameBesideMissingModuleName(f *testing.F) {
	for i := uint8(0); i < 8; i++ {
		f.Add([]byte{i}, i)
	}
	f.Fuzz(func(t *testing.T, padding []byte, cursor uint8) {
		if len(padding) > 64 {
			return
		}
		trivia := " "
		for _, b := range padding {
			trivia += []string{" ", "\t", " /* missing */ ", " /*\n*/ "}[int(b)%4]
		}
		name := []string{"result", "text"}[int(cursor)%2]
		checkRenameBesideMissingModule(t, trivia, name)
	})
}
