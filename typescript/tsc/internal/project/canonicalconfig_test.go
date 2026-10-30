package project_test

import (
	"context"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/project"
	"github.com/microsoft/TypeScript/tsc/internal/testutil/projecttestutil"
	"gotest.tools/v3/assert"
)

func TestCanonicalConfigDiscovery(t *testing.T) {
	for _, tc := range []struct {
		name    string
		configs map[string]any
		want    string
	}{
		{"canonical only", map[string]any{"/src/vibe.config.json": `{"compilerOptions":{"noLib":true}}`}, "/src/vibe.config.json"},
		{"canonical wins same directory", map[string]any{"/src/vibe.config.json": `{"compilerOptions":{"noLib":true}}`, "/src/tsconfig.json": `{"compilerOptions":{"noLib":true}}`}, "/src/vibe.config.json"},
		{"nearer legacy wins", map[string]any{"/vibe.config.json": `{"compilerOptions":{"noLib":true}}`, "/src/tsconfig.json": `{"compilerOptions":{"noLib":true}}`}, "/src/tsconfig.json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := tc.configs
			files["/src/index.ts"] = `export const x = 1;`
			session, _ := projecttestutil.Setup(files)
			uri := lsproto.DocumentUri("file:///src/index.ts")
			session.DidOpenFile(context.Background(), uri, 1, files["/src/index.ts"].(string), lsproto.LanguageKindTypeScript)
			_, err := session.GetLanguageService(context.Background(), uri)
			assert.NilError(t, err)
			p := session.Snapshot().GetDefaultProject(uri)
			assert.Assert(t, p != nil)
			assert.Equal(t, p.Kind, project.KindConfigured)
			assert.Equal(t, p.ConfigFileName().AsString(), tc.want)
		})
	}
}

func TestCanonicalConfigDiscoveryWatch(t *testing.T) {
	ctx := context.Background()
	files := map[string]any{
		"/src/tsconfig.json": `{"compilerOptions":{"noLib":true}}`,
		"/src/index.ts":      `export const x = 1;`,
	}
	session, utils := projecttestutil.Setup(files)
	uri := lsproto.DocumentUri("file:///src/index.ts")
	session.DidOpenFile(ctx, uri, 1, files["/src/index.ts"].(string), lsproto.LanguageKindTypeScript)
	_, err := session.GetLanguageService(ctx, uri)
	assert.NilError(t, err)
	assert.Equal(t, session.Snapshot().GetDefaultProject(uri).ConfigFileName().AsString(), "/src/tsconfig.json")
	assert.NilError(t, utils.FS().WriteFile("/src/vibe.config.json", `{"compilerOptions":{"noLib":true}}`))
	session.DidChangeWatchedFiles(ctx, []*lsproto.FileEvent{{Uri: "file:///src/vibe.config.json", Type: lsproto.FileChangeTypeCreated}})
	_, err = session.GetLanguageService(ctx, uri)
	assert.NilError(t, err)
	assert.Equal(t, session.Snapshot().GetDefaultProject(uri).ConfigFileName().AsString(), "/src/vibe.config.json")
}
