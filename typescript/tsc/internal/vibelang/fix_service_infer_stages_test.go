package vibelang

import (
	"strings"
	"testing"
)

func TestLegacyServiceMigrationStages(t *testing.T) {
	source := "import { FileSystem } from \"effect\"\nexport const remove = (path: string): number!infer E!FileSystem.FileSystem => { const fs = FileSystem.FileSystem(); fs.remove(path); return 0 }\n"
	program, file, _, _ := editorProgram(t, source)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	edits, refused, _ := tryEdits(c, file, nil)
	proposed := applyEdits(source, edits)
	done()
	t.Logf("legacy service batch: edits=%d refusals=%d", len(edits), len(refused))
	for _, want := range []string{"= effect (", "const fs = try FileSystem.FileSystem;", "try fs.remove(path)"} {
		if !strings.Contains(proposed, want) {
			t.Fatalf("incomplete atomic migration: missing %q in %s", want, proposed)
		}
	}
	if len(refused) != 0 {
		t.Fatal(refused)
	}
	result, name := fixVIPOnlySource(t, source)
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("migration failed: %v %v", result.Err, result.Refused)
	}
	if result.Files[name] == nil || !strings.Contains(result.Files[name].Text, "try fs.remove(path)") || strings.Contains(result.Files[name].Text, "!never!") {
		t.Fatalf("lost legacy run or error channel: %v", result.Files[name])
	}
}

func TestLegacyServiceReadKeepsPlainOwner(t *testing.T) {
	source := "import { FileSystem } from \"effect\"\nexport const plain = (): number => { const fs = FileSystem.FileSystem(); return 0 }\n"
	program, file, _, _ := editorProgram(t, source)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	edits, _, _ := tryEdits(c, file, nil)
	if len(edits) != 0 {
		t.Fatalf("plain owner received migration edits: %v", edits)
	}
}

func TestLegacyServiceReadInsideCatchHead(t *testing.T) {
	source := "import { FileSystem } from \"effect\"\nconst decode = Schema.decodeUnknownOption(Schema.String)\nexport const read = (path: string): Option.Option<string>!infer E!FileSystem.FileSystem => { return decode((FileSystem.FileSystem()).readFileString(path)) catch () => Option.none<string>() }\n"
	result, name := fixVIPOnlySource(t, source)
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("nested service migration failed: %v %v", result.Err, result.Refused)
	}
	if result.Files[name] == nil || strings.Contains(result.Files[name].Text, "FileSystem.FileSystem()") || !strings.Contains(result.Files[name].Text, "try FileSystem.FileSystem") {
		t.Fatalf("nested service read was not migrated: %v", result.Files[name])
	}
}
