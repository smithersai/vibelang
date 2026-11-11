package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
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
// range. The server is the compiler's own (Chapter 7, "The editor", D32),
// and its diagnostics are the compiler's, at .vibe spans (Chapter 7,
// "Diagnostics", D61), so reusing an earlier snapshot's work must never
// change the answer. Between edits it also asks for hover and completions
// at the edit, as an editor does, so that state a request leaves behind is
// part of what the next snapshot could wrongly reuse.
//
// edits holds four-byte records: a file/operation selector, a token selector, then a
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
	// Chapter 7, The editor: an imported .vibe dependency must invalidate
	// its importer's snapshot when edited, just like the open main file.
	f.Add(Archive(map[string]string{
		"main.vibe": "import { value } from \"./dep.vibe\"\nexport function main() { return Effect.succeed(value) }\n",
		"dep.vibe":  "export const value = 1\n",
	}), []byte{0, 3, 0, 21})
	for _, seed := range toolsKeywordEditSeeds() {
		f.Add(Archive(map[string]string{"main.vibe": seed.source}), seed.edits)
		// Keep the edited main file after two dependencies in the selector.
		edits := slices.Clone(seed.edits)
		edits[0], edits[4] = 2, 2*3+2
		f.Add(Archive(map[string]string{
			"alpha.vibe": "export const alpha = 1",
			"beta.vibe":  "export const beta = 2",
			"main.vibe":  seed.source,
		}), edits)
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, archive string, edits []byte) {
		toolsGuard(t, "FuzzIncremental", func() {
			files := toolsUnarchive(archive)
			for name, text := range files {
				files[name] = strings.ToValidUTF8(text, "?") // an LSP document is UTF-8
			}
			main := toolsMainFile(files)
			if main == "" || toolsTooLarge(files) {
				return
			}
			toolsSkipLeftOut(t, "FuzzIncremental", files)
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
				file, operation, choice := toolsIncrementalSelectors(edits[i], edits[i+1], len(names))
				name := names[file]
				uri := toolsURI(dir, name)
				text := files[name]
				start, end, insert := toolsIncrementalEdit(text, operation, int(edits[i+2])<<8|int(edits[i+3]), choice)
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
// Chapter 7's editor serves the project, rather than a single document.
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
		// Chapter 7, The editor (D32/D61): an open document excluded by a
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

// toolsEditTokens combines Appendix A's contextual words with native
// TypeScript heads, compound forms and punctuation. Read the table on first
// use so subprocess probes need no specification files during initialization.
var toolsEditTokens = sync.OnceValue(func() []string {
	tokens := []string{
		"effect ", "effect", "try", "try.all", "interface", "class", "try ", "async",
		"|>", "%", "!", "catch", "catch (e) => ", "error", "service", "schema", "data", "throw", "using", "do", "module",
		"try.race", "try.any", "try.allSettled", "fork", "join",
		"Effect", "Layer", "Option", "yield", "return", "function", "export", "const", "let", "if", "else", "for", "of", "new",
		"=>", "{", "}", "(", ")", "[", "]", ";", ",", ".", ":", "=", "?", "<", ">",
	}
	tokens = append(tokens, "\n", " ", "\"", "'", "`", "${", "//", "/*", "*/", "@", "#", "1", "x", "e", "_tag")
	for _, row := range grammarReadKeywordTable(SpecText(grammarAppendix)) {
		for _, word := range row.Words {
			if !slices.Contains(tokens, word) {
				tokens = append(tokens, word)
			}
		}
	}
	return tokens
})

// These edits cross checking-context boundaries, then remove the keyword
// again: a native function becomes effect, and a cold call becomes try.
func toolsKeywordEditSeeds() []struct {
	source string
	edits  []byte
} {
	var seeds []struct {
		source string
		edits  []byte
	}
	for _, row := range []struct {
		source, before string
		token          byte
	}{
		{"export function check() { return Effect.succeed(1) }", "function", 0},
		{"export effect function check() { return Effect.succeed(1) }", "Effect.succeed", 6},
	} {
		offset := strings.Index(row.source, row.before)
		seeds = append(seeds, struct {
			source string
			edits  []byte
		}{row.source, []byte{0, row.token, byte(offset >> 8), byte(offset), 2, row.token, byte(offset >> 8), byte(offset)}})
	}
	return seeds
}

// The first byte spans the Cartesian product of files and operations; the
// second independently selects the token. toolsTooLarge admits at most twelve
// files, so all six operations fit for every file in the first byte.
func toolsIncrementalSelectors(selector, token byte, files int) (int, byte, byte) {
	return int(selector) % files, byte(int(selector) / files), token
}

// toolsIncrementalEdit decodes one edit of text: an operation byte and a
// position, with a separate token selector. It returns the replacement range
// and text. Neither end splits a character or a line ending.
func toolsIncrementalEdit(text string, op byte, position int, choice byte) (int, int, string) {
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
	// Token choice is independent of the operation: a token index modulo six
	// must not make a keyword unreachable for insertion or replacement.
	tokens := toolsEditTokens()
	token := tokens[int(choice)%len(tokens)]
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
