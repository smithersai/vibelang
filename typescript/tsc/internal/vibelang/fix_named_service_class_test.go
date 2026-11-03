package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// VIP-9's written whole shape preserves Context.Service<Self, Shape>
// directly, without synthesizing an inline shape or a public namespace.
func TestFixNamedServiceClasses(t *testing.T) {
	for _, tc := range []struct{ name, head, shape, body, key string }{
		{"interface", "interface Shape { readonly value: string }", "Shape", "{}", "\"alchemy/Database\""},
		{"alias", "type Shape = { readonly value: string }", "Shape", "{}", "\"alchemy/Database\""},
		{"generic", "type Shape<A> = { readonly value: A }", "Shape<number>", "{}", "\"alchemy/Database\""},
		{"intersection", "type Left = { readonly a: string }; type Right = { readonly b: number }", "Left & Right", "{}", "\"alchemy/Database\""},
		{"qualified", "namespace Types { export interface Shape { readonly value: string } }", "Types.Shape", "{}", "\"alchemy/Database\""},
		{"primitive", "", "number", "{}", "\"alchemy/Database\""},
		{"callable", "type Shape = () => number", "Shape", "{}", "\"alchemy/Database\""},
		{"empty-alias", "type Shape = {}", "Shape", "{}", "\"alchemy/Database\""},
		{"union", "type Shape = { readonly a: string } | { readonly b: number }", "Shape", "{}", "\"alchemy/Database\""},
		{"query", "declare const value: { readonly n: number }", "typeof value", "{}", "\"alchemy/Database\""},
		{"optional", "interface Shape { readonly value?: string; readonly nested: { readonly n: number } }", "Shape", "{}", "\"alchemy/Database\""},
		{"body-comment", "interface Shape { readonly value: string }", "Shape", "{ /* retain class body */ }", "\"alchemy/Database\""},
		{"header-comment", "interface Shape { readonly value: string }", "Shape", "/* retain brace trivia */ {}", "\"alchemy/Database\""},
		{"escaped-key", "interface Shape { readonly value: string }", "Shape", "{}", "\"alchemy/\\\"Database\\\"\""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "import * as Context from \"effect/Context\"\n" + tc.head + "\n/** Database docs. */\nexport class Database extends Context.Service<Database, " + tc.shape + ">()(" + tc.key + ") " + tc.body + "\n"
			got, result := fixedPipe(t, source)
			if result.Err != nil || len(result.Refused) != 0 || !strings.Contains(got, "service Database: "+tc.shape) || strings.Contains(got, "class Database extends") {
				t.Fatalf("named service fix missing: err=%v refused=%+v\n%s", result.Err, result.Refused, got)
			}
			if !strings.Contains(got, tc.key) || !strings.Contains(got, "/** Database docs. */") {
				t.Fatalf("lost key/docs:\n%s", got)
			}
			if i := strings.Index(tc.body, "/*"); i >= 0 {
				comment := tc.body[i:]
				comment = comment[:strings.Index(comment, "*/")+2]
				if !strings.Contains(got, comment) {
					t.Fatalf("lost body trivia:\n%s", got)
				}
			}
			if next, r := fixedPipe(t, got); next != got || r.Err != nil || len(r.Refused) != 0 {
				t.Fatalf("non-idempotent: %+v\n%s", r, next)
			}
		})
	}
}

func TestFixNamedServiceClassesKeepUnsafe(t *testing.T) {
	for _, tc := range []struct{ name, header, key, body string }{
		{"dynamic-key", "class Database", "makeKey()", "{}"},
		// The shared conservative comment guard treats // in a key as trivia.
		{"url-key-comment-guard", "class Database", "\"https://alchemy/Database\"", "{}"},
		{"static-member", "class Database", "\"alchemy/Database\"", "{ static readonly extra = 1 }"},
		{"instance-member", "class Database", "\"alchemy/Database\"", "{ readonly extra = 1 }"},
		{"class-comment", "class /* retain modifier trivia */ Database", "\"alchemy/Database\"", "{}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "import * as Context from \"effect/Context\"\ninterface Shape { readonly value: string }\ndeclare function makeKey(): string\nexport " + tc.header + " extends Context.Service<Database, Shape>()(" + tc.key + ") " + tc.body + "\n"
			got, result := fixedPipe(t, source)
			if result.Err != nil || got != source {
				t.Fatalf("unsafe class was changed: err=%v\n%s", result.Err, got)
			}
		})
	}
}

// The service's generated base type uses the author's Context alias even
// when declaration:false: VIP-27 still writes the module's sidecar.
func TestFixNamedServiceClassesKeepDeclarationAliases(t *testing.T) {
	for _, alias := range []string{"Context", "Ctx", "ServiceContext"} {
		for _, mode := range []struct{ name, value string }{{"declarations", "true"}, {"sidecar", "false"}} {
			t.Run(alias+"/"+mode.name, func(t *testing.T) {
				source := "import * as " + alias + " from \"effect/Context\"\ninterface Shape { readonly value: string }\nexport class Database extends " + alias + ".Service<Database, Shape>()(\"alchemy/Database\") {}\n"
				_, file, _, _ := editorProgram(t, source)
				dir := filepath.Dir(file.FileName().AsString())
				config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"declaration\":" + mode.value + "},\"files\":[\"main.vibe\"]}"
				if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
					t.Fatal(err)
				}
				result := fixCase(t, dir)
				fixed := result.Files[file.FileName()]
				if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
					t.Fatalf("no service repair: %+v", result)
				}
				if !strings.Contains(fixed.Text, "service Database: Shape") || !strings.Contains(fixed.Text, "import * as "+alias+" from \"effect/Context\"") {
					t.Fatalf("lost service declaration or its declaration alias:\n%s", fixed.Text)
				}
			})
		}
	}
}
