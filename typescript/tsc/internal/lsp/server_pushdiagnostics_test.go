package lsp_test

import (
	"context"
	"encoding/json"
	"io"

	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/lsp"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/testutil/lsptestutil"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"gotest.tools/v3/assert"
)

// A client that accepts pushed diagnostics and cannot pull them, as Claude
// Code's LSP client does, gets each open document's diagnostics published
// after it opens or changes the document. A client that pulls gets none
// pushed.
func TestPushesFileDiagnosticsToClientsThatCannotPull(t *testing.T) {
	t.Parallel()
	if !bundled.Embedded {
		t.Skip("bundled files are not embedded")
	}
	const uri = lsproto.DocumentUri("file:///src/a.ts")
	const broken = "export const n: number = \"one\";\n"

	// open starts a server for a client with these capabilities, opens a.ts
	// with an error, and returns the client and the diagnostics published for
	// a.ts, read once each.
	open := func(t *testing.T, textDocument *lsproto.TextDocumentClientCapabilities) (*lsptestutil.LSPClient, func(time.Duration) []*lsproto.Diagnostic) {
		files := map[string]string{"/src/tsconfig.json": `{ "compilerOptions": { "strict": true } }`, "/src/a.ts": broken}
		client, closeClient := lsptestutil.NewLSPClient(t, lsp.ServerOptions{
			Err: io.Discard, Cwd: "/src", FS: bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive)), DefaultLibraryPath: bundled.LibPath(),
		}, func(_ context.Context, req *lsproto.RequestMessage) *lsproto.ResponseMessage {
			return &lsproto.ResponseMessage{ID: req.ID, JSONRPC: req.JSONRPC, Result: lsproto.Null{}}
		})
		t.Cleanup(func() { _ = closeClient() })
		published := make(chan []*lsproto.Diagnostic, 16)
		client.OnServerNotification = func(_ context.Context, req *lsproto.RequestMessage) {
			if req.Method != lsproto.MethodTextDocumentPublishDiagnostics {
				return
			}
			data, err := json.Marshal(req.Params)
			assert.NilError(t, err)
			var params lsproto.PublishDiagnosticsParams
			assert.NilError(t, json.Unmarshal(data, &params))
			if params.Uri == uri {
				published <- params.Diagnostics
			}
		}
		msg, _, ok := client.SendRequest(t, lsproto.InitializeInfo, &lsproto.InitializeParams{Capabilities: &lsproto.ClientCapabilities{TextDocument: textDocument}})
		assert.Assert(t, ok && msg.AsResponse().Error == nil, "initialize failed")
		client.SendNotification(t, lsproto.InitializedInfo, &lsproto.InitializedParams{})
		<-client.Server.InitComplete()
		client.SendNotification(t, lsproto.TextDocumentDidOpenInfo, &lsproto.DidOpenTextDocumentParams{
			TextDocument: &lsproto.TextDocumentItem{Uri: uri, LanguageId: lsproto.LanguageKindTypeScript, Version: 1, Text: broken},
		})
		next := func(timeout time.Duration) []*lsproto.Diagnostic {
			select {
			case diagnostics := <-published:
				return diagnostics
			case <-time.After(timeout):
				return nil
			}
		}
		return client, next
	}

	t.Run("push only", func(t *testing.T) {
		t.Parallel()
		client, next := open(t, &lsproto.TextDocumentClientCapabilities{PublishDiagnostics: &lsproto.PublishDiagnosticsClientCapabilities{}})
		diagnostics := next(30 * time.Second)
		assert.Equal(t, len(diagnostics), 1, "the error in a.ts after didOpen")
		assert.Equal(t, *diagnostics[0].Code.Integer, int32(2322))

		client.SendNotification(t, lsproto.TextDocumentDidChangeInfo, &lsproto.DidChangeTextDocumentParams{
			TextDocument: lsproto.VersionedTextDocumentIdentifier{Uri: uri, Version: 2},
			ContentChanges: []lsproto.TextDocumentContentChangePartialOrWholeDocument{
				{WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{Text: "export const n: number = 1;\n"}},
			},
		})
		diagnostics = next(30 * time.Second)
		assert.Assert(t, diagnostics != nil, "no diagnostics published after didChange")
		assert.Equal(t, len(diagnostics), 0)
	})

	t.Run("pull", func(t *testing.T) {
		t.Parallel()
		_, next := open(t, &lsproto.TextDocumentClientCapabilities{
			PublishDiagnostics: &lsproto.PublishDiagnosticsClientCapabilities{}, Diagnostic: &lsproto.DiagnosticClientCapabilities{},
		})
		assert.Assert(t, next(2*time.Second) == nil, "a pull client got pushed file diagnostics")
	})
}
