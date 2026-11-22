package lsp_test

import (
	"context"
	"errors"
	"io"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/lsp"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/testutil/lsptestutil"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"gotest.tools/v3/assert"
)

func TestVibeOnTypeFormattingDoesNotInvokeWholeDocumentFormatter(t *testing.T) {
	t.Parallel()
	if !bundled.Embedded {
		t.Skip("bundled files are not embedded")
	}

	const source = "effect function f() {"
	files := map[string]string{
		"/home/project/tsconfig.json": `{"compilerOptions":{"target":"es2022","module":"nodenext","strict":true}}`,
		"/home/project/main.vibe":     source,
	}
	var calls atomic.Int32
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	client, closeClient := lsptestutil.NewLSPClient(t, lsp.ServerOptions{
		Err:                io.Discard,
		Cwd:                "/home/project",
		FS:                 fs,
		DefaultLibraryPath: bundled.LibPath(),
		FormatVibe: func(context.Context, string, string) (string, error) {
			calls.Add(1)
			return "", errors.New("dprint parse failure on incomplete input")
		},
	}, func(_ context.Context, req *lsproto.RequestMessage) *lsproto.ResponseMessage {
		switch req.Method {
		case lsproto.MethodWorkspaceConfiguration:
			return &lsproto.ResponseMessage{ID: req.ID, JSONRPC: req.JSONRPC, Result: []any{nil, nil, nil, nil}}
		case lsproto.MethodClientRegisterCapability, lsproto.MethodClientUnregisterCapability, lsproto.MethodWindowWorkDoneProgressCreate:
			return &lsproto.ResponseMessage{ID: req.ID, JSONRPC: req.JSONRPC, Result: lsproto.Null{}}
		}
		return nil
	})
	t.Cleanup(func() { _ = closeClient() })

	initMsg, _, ok := client.SendRequest(t, lsproto.InitializeInfo, &lsproto.InitializeParams{
		Capabilities: &lsproto.ClientCapabilities{},
	})
	assert.Assert(t, ok && initMsg.AsResponse().Error == nil, "initialize failed")
	client.SendNotification(t, lsproto.InitializedInfo, &lsproto.InitializedParams{})
	<-client.Server.InitComplete()

	uri := lsproto.DocumentUri("file:///home/project/main.vibe")
	client.SendNotification(t, lsproto.TextDocumentDidOpenInfo, &lsproto.DidOpenTextDocumentParams{
		TextDocument: &lsproto.TextDocumentItem{
			Uri:        uri,
			LanguageId: lsproto.LanguageKindTypeScript,
			Version:    1,
			Text:       source,
		},
	})

	msg, resp, ok := client.SendRequest(t, lsproto.TextDocumentOnTypeFormattingInfo, &lsproto.DocumentOnTypeFormattingParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
		Position:     lsproto.Position{Line: 0, Character: uint32(len(source))},
		Ch:           "{",
		Options:      &lsproto.FormattingOptions{TabSize: 2, InsertSpaces: true},
	})
	assert.Assert(t, ok && msg.AsResponse().Error == nil, "onTypeFormatting must not return an error on incomplete VibeLang code")
	assert.Equal(t, calls.Load(), int32(0), "onTypeFormatting must not invoke whole-document VibeLang formatter")
	if resp.TextEdits != nil {
		assert.Equal(t, len(*resp.TextEdits), 0)
	}
}
