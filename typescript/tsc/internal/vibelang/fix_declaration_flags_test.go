package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeclarationImportsIgnoreEmitFlags(t *testing.T) {
	for _, alias := range []string{"Context", "Ctx", "ServiceContext"} {
		for _, declaration := range []bool{false, true} {
			for _, noEmit := range []bool{false, true} {
				for _, noUnused := range []bool{false, true} {
					name := alias + "/" + map[bool]string{false: "sidecar", true: "declaration"}[declaration] + "/" + map[bool]string{false: "emit", true: "noEmit"}[noEmit] + "/unused=" + map[bool]string{false: "false", true: "true"}[noUnused]
					t.Run(name, func(t *testing.T) {
						source := "import * as " + alias + " from \"effect/Context\"\nexport class Database extends " + alias + ".Service<Database,{readonly value:string}>()(\"alchemy/Database\") {}\n"
						_, file, _, _ := editorProgram(t, source)
						dir := filepath.Dir(file.FileName().AsString())
						config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"declaration\":" + map[bool]string{false: "false", true: "true"}[declaration] + ",\"noEmit\":" + map[bool]string{false: "false", true: "true"}[noEmit] + ",\"noUnusedLocals\":" + map[bool]string{false: "false", true: "true"}[noUnused] + "},\"files\":[\"main.vibe\"]}"
						if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
							t.Fatal(err)
						}
						result := fixCase(t, dir)
						if result.Err != nil || len(result.Refused) != 0 {
							t.Fatalf("fix: %+v", result)
						}
						fixed := result.Files[file.FileName()]
						if fixed == nil || !strings.Contains(fixed.Text, "service Database") || strings.Contains(fixed.Text, "import * as "+alias+" from \"effect/Context\"") == noUnused {
							t.Fatalf("emit flags removed the declaration import: %+v", fixed)
						}
					})
				}
			}
		}
	}
}
