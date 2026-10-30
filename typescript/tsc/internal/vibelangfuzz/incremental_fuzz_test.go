package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// FuzzIncremental opens a project's sources and configuration in the language server,
// applies a fuzz-chosen sequence of small textDocument/didChange edits (a
// character or a token inserted or deleted, VibeLang's own syntax included),
// and after each one compares the diagnostics the server reports with those
// of a fresh compilation of the same text: their source, code, severity and
// range. The server is the compiler's own (Chapter 28, "The editor", D32),
// and its diagnostics are the compiler's, at .vibe spans (Chapter 28,
// "Diagnostics", D61), so reusing an earlier snapshot's work must never
// change the answer. Between edits it also asks for hover and completions
// at the edit, as an editor does, so that state a request leaves behind is
// part of what the next snapshot could wrongly reuse.
//
// edits holds four-byte records: a file selector, an operation, then a
// big-endian byte offset into that file modulo its length.
func FuzzIncremental(f *testing.F) {
	startShortBudget(f)
	seeds := append(toolsSample(CaseSeeds(), 20, 400, func(s Seed) bool { return strings.HasPrefix(s.Name, "tsforms-") }), toolsSample(SnippetSeeds(), 12, 300, nil)...)
	for _, seed := range seeds {
		main := toolsMainFile(seed.Files)
		if main == "" {
			continue
		}
		var edits []byte
		offsets := toolsInterestingOffsets(seed.Files[main])
		for i := 0; i+1 < len(offsets); i += 2 {
			edits = append(edits, byte(i/2), byte(i*37+1), offsets[i], offsets[i+1])
		}
		f.Add(Archive(seed.Files), edits)
	}
	// Chapter 28, The editor: an imported .vibe dependency must invalidate
	// its importer's snapshot when edited, just like the open main file.
	f.Add(Archive(map[string]string{
		"main.vibe": "import { value } from \"./dep.vibe\"\nexport function main() { return Effect.succeed(value) }\n",
		"dep.vibe":  "export const value = 1\n",
	}), []byte{0, 3, 0, 21})
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, archive string, edits []byte) {
		toolsGuard(t, "FuzzIncremental", func() {
			files := toolsUnarchive(archive)
			for name, text := range files {
				files[name] = strings.ToValidUTF8(text, "?") // an LSP document is UTF-8
			}
			main := toolsMainFile(files)
			if main == "" || toolsTooLarge(files) || toolsLeftOut("FuzzIncremental", files) {
				return
			}
			dir, err := toolsWrite(w, Project{Files: files})
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			if program := toolsProgram(w, dir); program == nil || program.GetSourceFile(toolsFileName(dir, main)) == nil {
				return // a tsconfig that leaves the file out of its program
			}
			ctx := t.Context()
			session := sessions.get(t)
			var history []string
			run := func(stage string, fn func()) {
				t.Helper()
				toolsRun(t, "FuzzIncremental", stage, archive+"\nedits:\n"+strings.Join(history, "\n"), sessions.poison, fn)
			}
			names := toolsProjectFiles(files)
			versions := map[string]int32{}
			for _, name := range names {
				uri := toolsURI(dir, name)
				language := toolsDocumentLanguage(name)
				run("didOpen", func() { session.DidOpenFile(ctx, uri, 1, files[name], language) })
				versions[name] = 1
			}
			defer func() {
				if sessions.current == session {
					for _, name := range names {
						run("didClose", func() { session.DidCloseFile(ctx, toolsURI(dir, name)) })
					}
				}
			}()
			compare := func(step, name string) *ls.LanguageService {
				uri := toolsURI(dir, name)
				var service *ls.LanguageService
				var got []*lsproto.Diagnostic
				run("diagnostics", func() {
					if service, err = session.GetLanguageService(ctx, uri); err == nil {
						got, err = toolsDiagnostics(ctx, service, uri)
					}
				})
				// LSP 3.17 and D61: failed requests are not empty diagnostics.
				if err != nil {
					Gap(t, "FuzzIncremental", "incremental:request", "%s: %s diagnostics failed: %v\n%s", step, name, err, archive)
				}
				var want []*lsproto.Diagnostic
				run("fresh diagnostics", func() { want, err = toolsFreshDiagnostics(t, w, files, name) })
				if err != nil {
					Gap(t, "FuzzIncremental", "incremental:fresh-request", "%s: fresh %s diagnostics failed: %v\n%s", step, name, err, Archive(files))
				}
				if missing, extra := toolsDiagnosticDiff(want, got); len(missing)+len(extra) > 0 {
					Gap(t, "FuzzIncremental", "incremental:diagnostics", "after %s, %s reports diagnostics a fresh compilation does not (%v) and lacks ones it does (%v)\nedits:\n%s\nproject:\n%s\noriginal:\n%s",
						step, name, extra, missing, strings.Join(history, "\n"), Archive(files), archive)
				}
				return service
			}
			compare("didOpen", main)
			for i := 0; i+3 < len(edits) && i < 4*10; i += 4 {
				name := names[int(edits[i])%len(names)]
				uri := toolsURI(dir, name)
				text := files[name]
				start, end, insert := toolsIncrementalEdit(text, edits[i+1], int(edits[i+2])<<8|int(edits[i+3]))
				if start == end && insert == "" {
					continue
				}
				lines := newToolsLines(text)
				change := lsproto.Range{Start: lines.position(start), End: lines.position(end)}
				history = append(history, fmt.Sprintf("%s %d:%d-%d:%d %q", name, change.Start.Line, change.Start.Character, change.End.Line, change.End.Character, insert))
				versions[name]++
				run("didChange", func() {
					session.DidChangeFile(ctx, uri, versions[name], []lsproto.TextDocumentContentChangePartialOrWholeDocument{{
						Partial: &lsproto.TextDocumentContentChangePartial{Range: change, Text: insert},
					}})
				})
				files[name] = text[:start] + insert + text[end:]
				service := compare(fmt.Sprintf("edit %d of %s", len(history), name), main)
				if name != main && isSource(name) {
					service = compare(fmt.Sprintf("edit %d", len(history)), name)
				}
				if !isSource(name) {
					continue
				}
				at := newToolsLines(files[name]).position(start + len(insert))
				document := lsproto.TextDocumentIdentifier{Uri: uri}
				run("hover", func() { _, err = service.ProvideHover(ctx, &lsproto.HoverParams{TextDocument: document, Position: at}) })
				if err != nil && toolsSyntaxError(name, files[name]) == "" {
					Gap(t, "FuzzIncremental", "incremental:request:hover", "D61: hover failed: %v\n%s", err, Archive(files))
				}
				if len(history)%2 == 0 {
					run("completion", func() {
						_, err = service.ProvideCompletion(ctx, uri, at, &lsproto.CompletionContext{TriggerKind: lsproto.CompletionTriggerKindInvoked})
					})
					if err != nil && err != ls.ErrNeedsAutoImports && toolsSyntaxError(name, files[name]) == "" {
						Gap(t, "FuzzIncremental", "incremental:request:completion", "D61: completion failed: %v\n%s", err, Archive(files))
					}
				}
			}
		})
	})
}

// toolsProjectFiles includes dependencies and configuration as edit targets.
// Chapter 28's editor serves the project, rather than a single document.
func toolsProjectFiles(files map[string]string) []string {
	var names []string
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// toolsFreshDiagnostics asks a fresh program for one source's diagnostics.
// Request errors propagate, as required by LSP 3.17 and D61.
func toolsFreshDiagnostics(t *testing.T, w *Workspace, files map[string]string, name string) ([]*lsproto.Diagnostic, error) {
	t.Helper()
	dir, err := toolsWrite(w, Project{Files: files})
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	program := toolsProgram(w, dir)
	if program == nil || program.GetSourceFile(toolsFileName(dir, name)) == nil {
		// Chapter 28, The editor (D32/D61): an open document excluded by a
		// configuration edit is served by an inferred project. Compare with
		// a fresh server's project selection, rather than requesting a file
		// absent from a configured compiler program.
		session := toolsBareSession(w)
		defer session.Close()
		uri := toolsURI(dir, name)
		session.DidOpenFile(t.Context(), uri, 1, files[name], toolsDocumentLanguage(name))
		service, err := session.GetLanguageService(t.Context(), uri)
		if err != nil {
			return nil, err
		}
		return toolsDiagnostics(t.Context(), service, uri)
	}
	service, _ := toolsService(w, program, toolsFileName(dir, name))
	return toolsDiagnostics(t.Context(), service, toolsURI(dir, name))
}

// toolsDiagnosticDiff returns the diagnostics of want missing from got, and
// those of got missing from want, by toolsDiagnosticKey.
func toolsDiagnosticDiff(want, got []*lsproto.Diagnostic) (missing, extra []string) {
	counts := map[string]int{}
	for _, d := range got {
		counts[toolsDiagnosticKey(d)]++
	}
	for _, d := range want {
		key := toolsDiagnosticKey(d)
		if counts[key] > 0 {
			counts[key]--
		} else {
			missing = append(missing, key)
		}
	}
	for key, n := range counts {
		for range n {
			extra = append(extra, key)
		}
	}
	slices.Sort(missing)
	slices.Sort(extra)
	return missing, extra
}

// toolsEditTokens are what an incremental edit inserts or replaces: VibeLang's
// own syntax (Chapters 1-11 and SKILL.md's forms) beside TypeScript's
// punctuation.
var toolsEditTokens = []string{
	"|>", "%", "!", "catch", "catch (e) => ", "provide", "fork", "join", "match", "when", "is", "error", "service", "control",
	"schema", "data", "throw", "sync", "using", "wire", "detach", "do", "mutable", "module", "await.all", "await.race",
	"Effect", "Layer", "Option", "yield", "return", "function", "export", "const", "let", "if", "else", "for", "of", "new",
	"=>", "{", "}", "(", ")", "[", "]", ";", ",", ".", ":", "=", "?", "<", ">", "\n", " ", "\"", "'", "`", "${", "//",
	"/*", "*/", "@", "#", "1", "x", "e", "_tag",
}

// toolsIncrementalEdit decodes one edit of text: an operation byte and a
// position. It returns the byte range it replaces and its new text. Neither
// end splits a character or a "\r\n".
func toolsIncrementalEdit(text string, op byte, position int) (int, int, string) {
	snap := func(pos int) int {
		pos = toolsRuneStart(text, pos)
		if pos > 0 && pos < len(text) && text[pos-1] == '\r' && text[pos] == '\n' {
			pos--
		}
		return pos
	}
	pos := snap(position % (len(text) + 1))
	next := func(pos int) int { // the end of the character at pos
		if pos >= len(text) {
			return pos
		}
		if strings.HasPrefix(text[pos:], "\r\n") {
			return pos + 2
		}
		_, size := utf8.DecodeRuneInString(text[pos:])
		return pos + size
	}
	token := toolsEditTokens[int(op)%len(toolsEditTokens)]
	switch op % 6 {
	case 0: // insert a token
		return pos, pos, token
	case 1: // delete a character
		return pos, next(pos), ""
	case 2: // delete the word or punctuation at pos
		end := next(pos)
		if r, _ := utf8.DecodeRuneInString(text[min(pos, len(text)):]); unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$' {
			for end < len(text) {
				r, size := utf8.DecodeRuneInString(text[end:])
				if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '$' {
					break
				}
				end += size
			}
			for pos > 0 {
				r, size := utf8.DecodeLastRuneInString(text[:pos])
				if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '$' {
					break
				}
				pos -= size
			}
		}
		return pos, end, ""
	case 3: // replace a character with a token
		return pos, next(pos), token
	case 4: // start a line with a token
		return pos, pos, "\n" + token
	default: // delete a few characters
		end := pos
		for range int(op>>3)%6 + 2 {
			end = next(end)
		}
		return pos, end, ""
	}
}
