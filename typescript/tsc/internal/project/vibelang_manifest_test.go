package project_test

import (
	"context"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/project"
	"github.com/microsoft/TypeScript/tsc/internal/testutil/projecttestutil"
	"gotest.tools/v3/assert"
)

// A vibelang.manifest.json lists the declaration files a VibeLang build
// emitted (D500), and the checker trusts their plain functions. It reads the
// manifest after the snapshot has stopped tracking the files a program
// depends on, so the program itself never records it: a change to the
// manifest must rebuild the program, as a change to a package.json does, or
// the editor keeps the old manifest's diagnostics.
func TestManifestChangeRebuildsTheProgram(t *testing.T) {
	t.Parallel()
	files := map[string]any{
		"/home/projects/app/tsconfig.json":              `{"compilerOptions": {"noLib": true, "noEmit": true}}`,
		"/home/projects/app/index.ts":                   `import { double } from "./lib/double.js"; double(1);`,
		"/home/projects/app/lib/double.d.ts":            `export declare function double(n: number): number;`,
		"/home/projects/app/lib/vibelang.manifest.json": `{"declarations": ["double.d.ts"]}`,
	}
	for name, change := range map[string]func(*project.Session, *projecttestutil.SessionUtils, context.Context, lsproto.DocumentUri){
		"on disk": func(session *project.Session, utils *projecttestutil.SessionUtils, ctx context.Context, uri lsproto.DocumentUri) {
			assert.NilError(t, utils.FS().WriteFile("/home/projects/app/lib/vibelang.manifest.json", `{"declarations": []}`))
			session.DidChangeWatchedFiles(ctx, []*lsproto.FileEvent{{Uri: uri, Type: lsproto.FileChangeTypeChanged}})
		},
		"in an open editor": func(session *project.Session, utils *projecttestutil.SessionUtils, ctx context.Context, uri lsproto.DocumentUri) {
			session.DidChangeFile(ctx, uri, 2, []lsproto.TextDocumentContentChangePartialOrWholeDocument{{
				WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{Text: `{"declarations": []}`},
			}})
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ctx := context.Background()
			session, utils := projecttestutil.Setup(files)
			index := lsproto.DocumentUri("file:///home/projects/app/index.ts")
			session.DidOpenFile(ctx, index, 1, files["/home/projects/app/index.ts"].(string), lsproto.LanguageKindTypeScript)
			manifest := lsproto.DocumentUri("file:///home/projects/app/lib/vibelang.manifest.json")
			if name == "in an open editor" {
				session.DidOpenFile(ctx, manifest, 1, files["/home/projects/app/lib/vibelang.manifest.json"].(string), lsproto.LanguageKindJSON)
			}
			before, err := session.GetLanguageService(ctx, index)
			assert.NilError(t, err)
			change(session, utils, ctx, manifest)
			after, err := session.GetLanguageService(ctx, index)
			assert.NilError(t, err)
			assert.Assert(t, after.GetProgram() != before.GetProgram(), "the program was not rebuilt after its vibelang.manifest.json changed")
		})
	}
}
