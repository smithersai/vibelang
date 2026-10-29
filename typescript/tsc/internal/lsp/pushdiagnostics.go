package lsp

import (
	"context"
	"maps"
	"slices"
	"sync"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VibeLang: the server reports a document's diagnostics when the client pulls
// them (textDocument/diagnostic). A client that only accepts pushed
// diagnostics, such as Claude Code's, would otherwise see none, so for it the
// server publishes each open document's diagnostics after every open, change
// and save.

// pushDiagnosticsDelay lets a burst of changes settle into one publish.
const pushDiagnosticsDelay = 50 * time.Millisecond

// filePush holds the open documents and a generation that each change
// advances; only the newest generation publishes.
type filePush struct {
	mu         sync.Mutex
	open       map[lsproto.DocumentUri]struct{}
	generation uint64
}

// pushesFileDiagnostics reports whether the client accepts pushed
// diagnostics and cannot pull them.
func (s *Server) pushesFileDiagnostics() bool {
	if s.initializeParams == nil || s.initializeParams.Capabilities == nil || s.initializeParams.Capabilities.TextDocument == nil {
		return false
	}
	if options := s.initializationOptions; options != nil && options.DisablePushDiagnostics != nil && *options.DisablePushDiagnostics {
		return false
	}
	textDocument := s.initializeParams.Capabilities.TextDocument
	return textDocument.PublishDiagnostics != nil && textDocument.Diagnostic == nil
}

// documentOpened records an open document, then publishes diagnostics.
func (s *Server) documentOpened(uri lsproto.DocumentUri) {
	if !s.pushesFileDiagnostics() {
		return
	}
	s.filePush.mu.Lock()
	if s.filePush.open == nil {
		s.filePush.open = map[lsproto.DocumentUri]struct{}{}
	}
	s.filePush.open[uri] = struct{}{}
	s.filePush.mu.Unlock()
	s.pushFileDiagnostics()
}

// documentClosed forgets a document and clears the diagnostics it showed.
func (s *Server) documentClosed(uri lsproto.DocumentUri) {
	if !s.pushesFileDiagnostics() {
		return
	}
	s.filePush.mu.Lock()
	delete(s.filePush.open, uri)
	s.filePush.generation++
	s.filePush.mu.Unlock()
	_ = s.PublishDiagnostics(s.pushContext(), &lsproto.PublishDiagnosticsParams{Uri: uri, Diagnostics: []*lsproto.Diagnostic{}})
	s.pushFileDiagnostics()
}

// pushFileDiagnostics publishes the diagnostics of every open document in
// the background, unless a later change starts a newer publish first.
func (s *Server) pushFileDiagnostics() {
	if !s.pushesFileDiagnostics() {
		return
	}
	s.filePush.mu.Lock()
	s.filePush.generation++
	generation := s.filePush.generation
	uris := slices.Sorted(maps.Keys(s.filePush.open))
	s.filePush.mu.Unlock()
	go func() {
		time.Sleep(pushDiagnosticsDelay)
		ctx := core.WithCheckerLifetime(s.pushContext(), core.CheckerLifetimeDiagnostics)
		for _, uri := range uris {
			if ctx.Err() != nil || !s.filePush.current(generation) {
				return
			}
			languageService, err := s.session.GetLanguageService(ctx, uri)
			if err != nil {
				continue
			}
			report, err := languageService.ProvideDiagnostics(ctx, uri)
			if err != nil || report.FullDocumentDiagnosticReport == nil {
				continue
			}
			diagnostics := report.FullDocumentDiagnosticReport.Items
			if diagnostics == nil {
				diagnostics = []*lsproto.Diagnostic{}
			}
			s.filePush.mu.Lock()
			if s.filePush.generation == generation {
				_ = s.PublishDiagnostics(ctx, &lsproto.PublishDiagnosticsParams{Uri: uri, Diagnostics: diagnostics})
			}
			s.filePush.mu.Unlock()
		}
	}()
}

func (p *filePush) current(generation uint64) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.generation == generation
}

func (s *Server) pushContext() context.Context {
	if s.backgroundCtx != nil {
		return s.backgroundCtx
	}
	return context.Background()
}
