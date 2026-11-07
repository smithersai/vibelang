package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A foreign function a declaration file imports may throw like JSON.parse:
// inside a fiber callback --fix wraps the body (drive-t3code 12:06Z witness).
func TestFixNothrowCallbackForeignCall(t *testing.T) {
	const tsconfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"files":["main.vibe","foreign.d.ts"]}`
	for _, tc := range []struct{ name, source, want string }{
		{"suspend", "import * as Effect from \"effect/Effect\";\nimport { foreign } from \"./foreign.js\";\nexport const program = Effect.suspend(() => { foreign(\"failure\"); return Effect.void; });\n",
			"Effect.suspend(() => { try { foreign(\"failure\"); return Effect.void; } catch (thrown) { return die(thrown) } })"},
		{"suspend-die", "import * as Effect from \"effect/Effect\";\nimport { die } from \"effect/Effect\";\nimport { foreign } from \"./foreign.js\";\nexport const program = Effect.suspend(() => { foreign(\"failure\"); return Effect.void; });\n",
			"catch (thrown) { return die(thrown) }"},
		{"catch", "import * as Effect from \"effect/Effect\";\nimport { foreign } from \"./foreign.js\";\nexport const program = Effect.fail(1).pipe(Effect.catch(() => { foreign(\"failure\"); return Effect.void; }));\n",
			"catch (thrown) { return die(thrown) }"},
		{"prelude", "import { foreign } from \"./foreign.js\";\nexport const program = Effect.suspend(() => { foreign(\"failure\"); return Effect.void; });\n",
			"catch (thrown) { return die(thrown) }"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgramConfig(t, tc.source, editorPackageJSON, editorPackages, tsconfig)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "foreign.d.ts"), []byte("export declare function foreign(error: unknown): { readonly errorType: \"object\" };\n"), 0600); err != nil {
				t.Fatal(err)
			}
			r := fixCase(t, dir)
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			fixed := r.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, tc.want) || len(r.Sites) != 0 {
				text := ""
				if fixed != nil {
					text = fixed.Text
				}
				t.Fatalf("missing callback defect repair, want %q\ntext: %s\nresult: %+v", tc.want, text, r)
			}
		})
	}
}
