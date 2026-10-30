package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGenericDataHelperImportMigration(t *testing.T) {
	cases := []struct{ source, want string }{
		{"import type {GDefinition} from \"./model.js\"\nexport type Saved=GDefinition\n", "$G$Definition as GDefinition"},
		{"import type {GDefinition as Local} from \"./model.js\"\nexport type Saved=Local\n", "$G$Definition as Local"},
		{"export type {GDefinition} from \"./model.js\"\n", "$G$Definition as GDefinition"},
		{"export type {GDefinition as Saved} from \"./model.js\"\n", "$G$Definition as Saved"},
		{"import type * as Model from \"./model.js\"\nexport type Saved=Model.GDefinition\n", "Model.$G$Definition"},
		{"export type Saved=import(\"./model.js\").GDefinition\n", ").$G$Definition"},
	}
	for _, consumerName := range []string{"main.vibe", "main.ts", "main.tsx"} {
		for _, declarationFile := range []bool{false, true} {
			for _, tc := range cases {
				t.Run(tc.want+map[bool]string{false: "/source", true: "/dts"}[declarationFile]+"/"+consumerName, func(t *testing.T) {
					_, file, _, _ := editorProgram(t, tc.source)
					dir := filepath.Dir(file.FileName().AsString())
					if consumerName != "main.vibe" {
						if err := os.Rename(file.FileName().AsString(), filepath.Join(dir, consumerName)); err != nil {
							t.Fatal(err)
						}
					}
					modelName := "model.vibe"
					model := "export data G<T> { V {value:T} }\n"
					if declarationFile {
						modelName = "model.d.ts"
						model = "import type {Data} from \"effect\"\nexport type G<T> = Data.TaggedEnum<{V:{value:T}}>\nexport interface $G$Definition extends Data.TaggedEnum.WithGenerics<1> {readonly taggedEnum:G<this[\"A\"]>}\nexport declare const G:ReturnType<typeof Data.taggedEnum<$G$Definition>>\n"
					}
					if err := os.WriteFile(filepath.Join(dir, modelName), []byte(model), 0600); err != nil {
						t.Fatal(err)
					}
					config := "{\"compilerOptions\":{\"target\":\"ESNext\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"" + consumerName + "\",\"" + modelName + "\"]}"
					if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
						t.Fatal(err)
					}
					result := fixCase(t, dir)
					if strings.HasSuffix(consumerName, ".ts") || strings.HasSuffix(consumerName, ".tsx") {
						// VIP-34 excludes native TypeScript from automatic migration.
						if result.Err != nil || len(result.Files) != 0 || len(result.Refused) != 0 {
							t.Fatalf("native consumer must remain unchanged: %+v", result)
						}
						actual, err := os.ReadFile(filepath.Join(dir, consumerName))
						if err != nil || string(actual) != tc.source {
							t.Fatalf("native source changed: %s, %v", actual, err)
						}
						return
					}
					if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
						t.Fatalf("fix: %+v", result)
					}
					var fixed string
					for _, f := range result.Files {
						fixed = f.Text
					}
					if !strings.Contains(fixed, tc.want) {
						t.Fatalf("binding changed or helper missing:\n%s\nwant%s", fixed, tc.want)
					}
					if err := os.WriteFile(filepath.Join(dir, consumerName), []byte(fixed), 0600); err != nil {
						t.Fatal(err)
					}
					if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
						t.Fatalf("not idempotent: %+v", again)
					}
				})
			}
		}
	}
}
