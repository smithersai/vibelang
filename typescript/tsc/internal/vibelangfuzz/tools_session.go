package vibelangfuzz

import (
	"context"
	stdjson "encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/autoimport"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/project"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The language server under test is the fork's own (Chapter 28, "The
// editor", D32): a project.Session, the state the LSP server keeps, which
// opens documents, applies didChange edits, and hands out a language service
// per snapshot. The targets drive it in process, as the server's handlers do.

// toolsWrite writes a project to a new subdirectory of the workspace, as
// Compile does, without compiling it, and returns the directory.
func toolsWrite(w *Workspace, p Project) (string, error) {
	dir := filepath.Join(w.Dir, fmt.Sprintf("p%d", w.next.Add(1)))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	config := p.Config
	if config == "" {
		var names []string
		for name := range p.Files {
			if isSource(name) {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		listed, _ := stdjson.Marshal(names)
		config = strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": " + string(listed) + "\n}"
	}
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0o600); err != nil {
		return "", err
	}
	for name, text := range p.Files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// toolsFileName returns the rooted name of a project file.
func toolsFileName(dir, name string) tspath.RootedFilePath {
	return tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, filepath.FromSlash(name))))
}

// toolsURI returns the document URI of a project file.
func toolsURI(dir, name string) lsproto.DocumentUri {
	return lsconv.FileNameToDocumentURI(toolsFileName(dir, name))
}

// toolsConfig parses the tsconfig.json of a project directory.
func toolsConfig(w *Workspace, dir string) *tsoptions.ParsedCommandLine {
	path := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	parsed, _ := tsoptions.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{}, nil, w.fs, nil)
	return parsed
}

// toolsProgram builds the program of a project directory without checking
// it, with the workspace's shared library and package files, as a fresh
// compilation would.
func toolsProgram(w *Workspace, dir string) *compiler.Program {
	parsed := toolsConfig(w, dir)
	if parsed == nil {
		return nil
	}
	host := &sharingHost{CompilerHost: compiler.NewCompilerHost(w.fs, bundled.LibPath(), nil, nil, nil), files: &w.files}
	return compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: host})
}

// toolsPreferences are an editor's preferences with every inlay hint on, so
// that the inlay hint request has work to do.
func toolsPreferences() lsutil.UserPreferences {
	preferences := lsutil.NewDefaultUserPreferences()
	preferences.InlayHintsPreferences = lsutil.InlayHintsPreferences{
		IncludeInlayEnumMemberValueHints:                      core.TSTrue,
		IncludeInlayFunctionLikeReturnTypeHints:               core.TSTrue,
		IncludeInlayFunctionParameterTypeHints:                core.TSTrue,
		IncludeInlayParameterNameHints:                        lsutil.IncludeInlayParameterNameHintsAll,
		IncludeInlayParameterNameHintsWhenArgumentMatchesName: core.TSTrue,
		IncludeInlayPropertyDeclarationTypeHints:              core.TSTrue,
		IncludeInlayVariableTypeHints:                         core.TSTrue,
		IncludeInlayVariableTypeHintsWhenTypeMatchesName:      core.TSTrue,
	}
	return preferences
}

// toolsService is a language service over a program, for a fresh answer to
// compare the session's with.
func toolsService(w *Workspace, program *compiler.Program, file tspath.RootedFilePath) (*ls.LanguageService, *lsconv.Converters) {
	host := &toolsHost{program: program, w: w}
	host.converters = lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		text, _ := host.ReadFile(name)
		return lsconv.ComputeLSPLineStarts(text)
	})
	return ls.NewLanguageService(nil, program, host, file.AsString()), host.converters
}

type toolsHost struct {
	program    *compiler.Program
	w          *Workspace
	converters *lsconv.Converters
}

func (h *toolsHost) CaseSensitivity() tspath.CaseSensitivity { return h.w.fs.CaseSensitivity() }
func (h *toolsHost) ReadFile(path tspath.RootedFilePath) (string, bool) {
	if file := h.program.GetSourceFile(path); file != nil {
		return file.Text(), true
	}
	return h.w.fs.ReadFile(path)
}
func (h *toolsHost) Converters() *lsconv.Converters                                { return h.converters }
func (h *toolsHost) GetPreferences(string) lsutil.UserPreferences                  { return toolsPreferences() }
func (h *toolsHost) GetECMALineInfo(tspath.RootedFilePath) *sourcemap.ECMALineInfo { return nil }
func (h *toolsHost) AutoImportRegistry() *autoimport.Registry                      { return nil }
func (h *toolsHost) ReadDirectory(tspath.RootedDirectoryPath, []string, []string, []string, int) []tspath.RootedFilePath {
	return nil
}
func (h *toolsHost) GetDirectories(tspath.RootedDirectoryPath) []string { return nil }
func (h *toolsHost) DirectoryExists(path tspath.RootedDirectoryPath) bool {
	return h.w.fs.DirectoryExists(path)
}
func (h *toolsHost) FileExists(path tspath.RootedFilePath) bool { return h.w.fs.FileExists(path) }

// A toolsSession is a language server session over a workspace. It keeps an
// anchor document open for its whole life, so that the library and package
// declaration files stay parsed between inputs, as they do in an editor.
type toolsSession struct {
	*project.Session
}

const toolsAnchorSource = "error Missing { id: number }\nexport function main() {\n  return Effect.succeed(1) catch (e) => 0\n}\n"

func toolsBareSession(w *Workspace) *toolsSession {
	ctx := context.Background()
	session := project.NewSession(&project.SessionInit{
		BackgroundCtx: ctx,
		Options: &project.SessionOptions{
			CurrentDirectory:   tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(w.Dir)),
			DefaultLibraryPath: bundled.LibPath(),
			PositionEncoding:   lsproto.PositionEncodingKindUTF16,
		},
		FS:     w.fs,
		Client: toolsClient{},
	})
	session.InitializeWithUserConfig(toolsPreferences())
	return &toolsSession{session}
}

func newToolsSession(w *Workspace) (*toolsSession, error) {
	ctx := context.Background()
	session := toolsBareSession(w)
	dir, err := toolsWrite(w, Single(toolsAnchorSource))
	if err != nil {
		session.Close()
		return nil, err
	}
	uri := toolsURI(dir, "main.vibe")
	session.DidOpenFile(ctx, uri, 1, toolsAnchorSource, toolsLanguage)
	if _, err := session.GetLanguageService(ctx, uri); err != nil {
		session.Close()
		return nil, err
	}
	return session, nil
}

// toolsSessions hands out one session per fuzz worker. A panic inside the
// session may leave its locks held, so a target that recovers one poisons
// the session and the next input starts a new one, as a restarted server
// would.
type toolsSessions struct {
	w       *Workspace
	current *toolsSession
}

func newToolsSessions(f *testing.F, w *Workspace) *toolsSessions {
	s := &toolsSessions{w: w}
	f.Cleanup(func() {
		if s.current != nil {
			s.current.Close()
		}
	})
	return s
}

func (s *toolsSessions) get(t *testing.T) *toolsSession {
	t.Helper()
	if s.current == nil {
		session, err := newToolsSession(s.w)
		if err != nil {
			t.Fatal(err)
		}
		s.current = session
	}
	return s.current
}

// poison abandons the current session without closing it, since closing
// waits for locks that a panic may hold.
func (s *toolsSessions) poison() { s.current = nil }

// toolsLanguage is the language id the VS Code extension sends for a .vibe
// document (typescript/vibelang/lsp-smoke.mjs).
const toolsLanguage = lsproto.LanguageKind("vibe")

// toolsDocumentLanguage opens dependencies with their own language, as an
// editor does (Chapter 28, The editor, D32), including config documents.
func toolsDocumentLanguage(name string) lsproto.LanguageKind {
	switch {
	case strings.HasSuffix(name, ".vibe"):
		return toolsLanguage
	case strings.HasSuffix(name, ".json"):
		return lsproto.LanguageKindJSON
	case strings.HasSuffix(name, ".tsx"):
		return lsproto.LanguageKindTypeScriptReact
	case strings.HasSuffix(name, ".js"), strings.HasSuffix(name, ".mjs"), strings.HasSuffix(name, ".cjs"):
		return lsproto.LanguageKindJavaScript
	case strings.HasSuffix(name, ".jsx"):
		return lsproto.LanguageKindJavaScriptReact
	default:
		return lsproto.LanguageKindTypeScript
	}
}

// toolsClient is an LSP client that accepts every notification.
type toolsClient struct{}

func (toolsClient) WatchFiles(context.Context, project.WatcherID, []*lsproto.FileSystemWatcher) error {
	return nil
}
func (toolsClient) UnwatchFiles(context.Context, project.WatcherID) error           { return nil }
func (toolsClient) RegisterContentMapperExtensions(context.Context, []string) error { return nil }
func (toolsClient) RefreshDiagnostics(context.Context) error                        { return nil }
func (toolsClient) PublishDiagnostics(context.Context, *lsproto.PublishDiagnosticsParams) error {
	return nil
}
func (toolsClient) RefreshInlayHints(context.Context) error                     { return nil }
func (toolsClient) RefreshCodeLens(context.Context) error                       { return nil }
func (toolsClient) ProgressStart(*diagnostics.Message, ...any)                  {}
func (toolsClient) ProgressFinish(*diagnostics.Message, ...any)                 {}
func (toolsClient) SendTelemetry(context.Context, lsproto.TelemetryEvent) error { return nil }
func (toolsClient) IsActive() bool                                              { return true }
func (toolsClient) SetLocale(string)                                            {}
func (toolsClient) GetLocale() locale.Locale                                    { return locale.Default }

// toolsDiagnostics returns the LSP diagnostic report and preserves request
// errors. LSP 3.17 and D61 do not equate a failed request with an empty report.
func toolsDiagnostics(ctx context.Context, service *ls.LanguageService, uri lsproto.DocumentUri) ([]*lsproto.Diagnostic, error) {
	response, err := service.ProvideDiagnostics(ctx, uri)
	if err != nil {
		return nil, err
	}
	if response.FullDocumentDiagnosticReport == nil {
		return nil, fmt.Errorf("diagnostics of %s returned no full report", uri)
	}
	return response.FullDocumentDiagnosticReport.Items, nil
}

// toolsDiagnosticKey is what the editor shows of a diagnostic: its source,
// code, severity and range (Chapter 28, D61). The message is left out: the
// order in which a checker creates types may change how a message prints a
// union, which is no change of meaning.
func toolsDiagnosticKey(d *lsproto.Diagnostic) string {
	source, code, severity := "", "", 0
	if d.Source != nil {
		source = *d.Source
	}
	if d.Code != nil && d.Code.Integer != nil {
		code = fmt.Sprint(*d.Code.Integer)
	} else if d.Code != nil && d.Code.String != nil {
		code = *d.Code.String
	}
	if d.Severity != nil {
		severity = int(*d.Severity)
	}
	return fmt.Sprintf("%s%s sev%d %d:%d-%d:%d", source, code, severity, d.Range.Start.Line, d.Range.Start.Character, d.Range.End.Line, d.Range.End.Character)
}

// toolsDiagnosticCode returns an LSP diagnostic's numeric code and its
// source, "EK" for VibeLang's own (D61).
func toolsDiagnosticCode(d *lsproto.Diagnostic) (int32, string) {
	source := ""
	if d.Source != nil {
		source = *d.Source
	}
	if d.Code != nil && d.Code.Integer != nil {
		return *d.Code.Integer, source
	}
	return 0, source
}

// toolsBadRanges returns a description of each range or position in an LSP
// response that does not lie inside its document (LSP 3.17: a position is a
// line and a UTF-16 offset in it, and a range runs from start to end). doc is
// the document the request named, which holds every range that names no
// document of its own; read returns the text of a document.
func toolsBadRanges(response any, doc lsproto.DocumentUri, read func(lsproto.DocumentUri) (string, bool)) []string {
	data, err := json.Marshal(response)
	if err != nil {
		return []string{"the response does not marshal: " + err.Error()}
	}
	var value any
	if err := stdjson.Unmarshal(data, &value); err != nil {
		return []string{"the response does not unmarshal: " + err.Error()}
	}
	lines := map[lsproto.DocumentUri]*toolsLines{}
	linesOf := func(uri lsproto.DocumentUri) *toolsLines {
		if l, ok := lines[uri]; ok {
			return l
		}
		var l *toolsLines
		if text, ok := read(uri); ok {
			l = newToolsLines(text)
		}
		lines[uri] = l
		return l
	}
	var bad []string
	var walk func(v any, uri lsproto.DocumentUri, path string)
	walk = func(v any, uri lsproto.DocumentUri, path string) {
		switch x := v.(type) {
		case []any:
			for i, child := range x {
				walk(child, uri, fmt.Sprintf("%s[%d]", path, i))
			}
		case map[string]any:
			if r, ok := toolsAsRange(x); ok {
				if l := linesOf(uri); l != nil {
					if _, _, ok := l.span(r); !ok {
						bad = append(bad, fmt.Sprintf("%s: range %d:%d-%d:%d is not inside %s", path, r.Start.Line, r.Start.Character, r.End.Line, r.End.Character, uri))
					}
				}
				return
			}
			if u, ok := x["uri"].(string); ok {
				uri = lsproto.DocumentUri(u)
			}
			if document, ok := x["textDocument"].(map[string]any); ok {
				if u, ok := document["uri"].(string); ok {
					uri = lsproto.DocumentUri(u)
				}
			}
			if start, ok := x["startLine"].(float64); ok {
				end, _ := x["endLine"].(float64)
				if l := linesOf(uri); l != nil && (int(end) >= len(l.starts) || end < start) {
					bad = append(bad, fmt.Sprintf("%s: folding lines %v-%v are not inside %s", path, start, end, uri))
				}
			}
			for key, child := range x {
				switch key {
				case "data", "command", "documentation", "contents", "message", "label", "tooltip", "detail":
					// Opaque data and text, not locations.
				case "targetRange", "targetSelectionRange":
					target, _ := x["targetUri"].(string)
					walk(child, lsproto.DocumentUri(target), path+"."+key)
				case "changes":
					if changes, ok := child.(map[string]any); ok {
						for u, edits := range changes {
							walk(edits, lsproto.DocumentUri(u), path+".changes")
						}
					}
				case "position":
					if p, ok := toolsAsPosition(child); ok {
						if l := linesOf(uri); l != nil && l.offset(p) < 0 {
							bad = append(bad, fmt.Sprintf("%s: position %d:%d is not inside %s", path, p.Line, p.Character, uri))
						}
					}
				default:
					walk(child, uri, path+"."+key)
				}
			}
		}
	}
	walk(value, doc, "response")
	return bad
}

func toolsAsPosition(v any) (lsproto.Position, bool) {
	m, ok := v.(map[string]any)
	if !ok || len(m) != 2 {
		return lsproto.Position{}, false
	}
	line, ok1 := m["line"].(float64)
	character, ok2 := m["character"].(float64)
	return lsproto.Position{Line: uint32(line), Character: uint32(character)}, ok1 && ok2
}

func toolsAsRange(m map[string]any) (lsproto.Range, bool) {
	if len(m) != 2 {
		return lsproto.Range{}, false
	}
	start, ok1 := toolsAsPosition(m["start"])
	end, ok2 := toolsAsPosition(m["end"])
	return lsproto.Range{Start: start, End: end}, ok1 && ok2
}

// toolsBadSemanticTokens returns a description of each semantic token that
// does not lie inside one line of the document (LSP 3.17's relative encoding,
// five numbers per token).
func toolsBadSemanticTokens(data []uint32, lines *toolsLines) []string {
	var bad []string
	line, character := 0, 0
	for i := 0; i+4 < len(data); i += 5 {
		if data[i] > 0 {
			line += int(data[i])
			character = int(data[i+1])
		} else {
			character += int(data[i+1])
		}
		length := int(data[i+2])
		if line >= len(lines.starts) || lines.offset(lsproto.Position{Line: uint32(line), Character: uint32(character + length)}) < 0 {
			bad = append(bad, fmt.Sprintf("semantic token %d at %d:%d, length %d, is not inside its line", i/5, line, character, length))
		}
	}
	if len(data)%5 != 0 {
		bad = append(bad, fmt.Sprintf("%d semantic token numbers are not a multiple of five", len(data)))
	}
	return bad
}

// toolsWorkspaceEdits returns a workspace edit's text edits by document.
func toolsWorkspaceEdits(edit *lsproto.WorkspaceEdit) (map[lsproto.DocumentUri][]*lsproto.TextEdit, bool) {
	result := map[lsproto.DocumentUri][]*lsproto.TextEdit{}
	if edit == nil {
		return result, true
	}
	if edit.Changes != nil {
		for uri, edits := range *edit.Changes {
			result[uri] = append(result[uri], edits...)
		}
	}
	if edit.DocumentChanges != nil {
		for _, change := range *edit.DocumentChanges {
			if change.TextDocumentEdit == nil {
				return nil, false // a file creation, rename or deletion
			}
			for _, e := range change.TextDocumentEdit.Edits {
				switch {
				case e.TextEdit != nil:
					result[change.TextDocumentEdit.TextDocument.Uri] = append(result[change.TextDocumentEdit.TextDocument.Uri], e.TextEdit)
				case e.AnnotatedTextEdit != nil:
					result[change.TextDocumentEdit.TextDocument.Uri] = append(result[change.TextDocumentEdit.TextDocument.Uri], &lsproto.TextEdit{Range: e.AnnotatedTextEdit.Range, NewText: e.AnnotatedTextEdit.NewText})
				default:
					return nil, false
				}
			}
		}
	}
	return result, true
}

// toolsErrorCounts counts a compilation's errors by file and code. Edits move
// errors, so their positions are left out.
func toolsErrorCounts(r *Result) map[string]int {
	counts := map[string]int{}
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			counts[toolsFileCode(r, d)]++
		}
	}
	return counts
}

// toolsFileCode names a diagnostic by its file, relative to the project, and
// its code, EK or TS.
func toolsFileCode(r *Result, d *ast.Diagnostic) string {
	file := ""
	if d.File() != nil {
		file = strings.TrimPrefix(d.File().FileName().AsString(), filepath.ToSlash(r.Dir)+"/")
	}
	source := d.Source()
	if source == "" {
		source = "TS"
	}
	if source == "EK" {
		return fmt.Sprintf("%s: EK%04d", file, d.Code())
	}
	return fmt.Sprintf("%s: %s%d", file, source, d.Code())
}

// toolsAddedErrors returns the errors after reports more often than before,
// by file and code.
func toolsAddedErrors(before, after *Result) []string {
	baseline := toolsErrorCounts(before)
	var added []string
	for key, n := range toolsErrorCounts(after) {
		if n > baseline[key] {
			added = append(added, key)
		}
	}
	slices.Sort(added)
	if len(added) > 0 {
		for _, d := range after.Diagnostics {
			if d.Category() == diagnostics.CategoryError && slices.Contains(added, toolsFileCode(after, d)) {
				added = append(added, "  "+d.String())
				break
			}
		}
	}
	return added
}
