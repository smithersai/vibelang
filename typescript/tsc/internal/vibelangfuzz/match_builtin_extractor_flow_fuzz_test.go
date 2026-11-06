package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const builtinExtractorFlowTypesTarget = "FuzzBuiltinExtractorFlow"
const builtinExtractorFlowRowQuote = "| ordinary class \x60C\x60 without an own matcher | \x60s instanceof C\x60 |"
const builtinExtractorFlowDefaultQuote = "a \x60default\x60 arm follows TypeScript control flow after every preceding ordered pattern and guard test has failed"

func builtinExtractorFlowQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{builtinExtractorFlowRowQuote, builtinExtractorFlowDefaultQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			tb.Fatalf("class pattern typing rule changed: %q", quote)
		}
	}
}

func TestBuiltinExtractorFlowQuoted(t *testing.T) { builtinExtractorFlowQuotes(t) }

var builtinExtractorFlowClasses = []struct{ key, class string }{
	{"Array", "Array"}, {"ArrayAlias", "List"}, {"Bytes", "Uint8Array"}, {"BytesAlias", "Bytes"},
	{"BigBytes", "BigInt64Array"}, {"Date", "Date"}, {"Map", "Map"}, {"Set", "Set"},
	{"Promise", "Promise"}, {"RegExp", "RegExp"}, {"Error", "TypeError"}, {"Buffer", "ArrayBuffer"},
}
var builtinExtractorFlowSubjects = []struct{ key, subject string }{
	{"unknown", "unknown"}, {"any", "any"}, {"object", "object"},
	{"declared", "Uint8Array | string"}, {"readonly", "readonly number[] | string"},
	{"library", "Promise<number> | Map<string,number> | Date | null"},
}

const builtinExtractorFlowDeclarations = "const Bytes=Uint8Array;const List=Array;"

// tsc's declaration of the narrowed value is the oracle: the spec's counterpart
// is the instanceof test, so each program returns what its branch leaves on s.
func FuzzBuiltinExtractorFlow(f *testing.F) {
	startShortBudget(f)
	builtinExtractorFlowQuotes(f)
	var keys []string
	for _, class := range builtinExtractorFlowClasses {
		for _, subject := range builtinExtractorFlowSubjects {
			key := class.key + "/" + subject.key
			keys = append(keys, key)
			if subject.key == "unknown" {
				f.Add(key, uint8(0))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) * 31 % len(keys)
			key = keys[index]
		}
		class := builtinExtractorFlowClasses[index/len(builtinExtractorFlowSubjects)]
		subject := builtinExtractorFlowSubjects[index%len(builtinExtractorFlowSubjects)]
		variant %= 6
		header := builtinExtractorFlowDeclarations + fmt.Sprintf("declare const s:%s;", subject.subject)
		test := "s instanceof " + class.class
		if class.key == "Array" || class.key == "ArrayAlias" {
			test = "Array.isArray(s)"
		}
		variableLength := class.key == "Array" || class.key == "ArrayAlias" || class.key == "Bytes" || class.key == "BytesAlias" || class.key == "BigBytes"
		pattern := class.class + "(...)"
		if variant >= 3 {
			pattern = class.class + "(let value,...)"
			if variableLength {
				test = "(" + test + ") && s.length>=1"
			}
		}
		native := []string{
			"export function read(){if(" + test + "){return [s]}return undefined}",
			"export function read(){if(" + test + "){return undefined}return [s]}",
			"export function read(){if(!(" + test + ")){return [s]}return undefined}",
		}[variant%3]
		custom := []string{
			"export function read(){return match (s) {when " + pattern + ": [s];default: undefined;}}",
			"export function read(){return match (s) {when " + pattern + ": undefined;default: [s];}}",
			"export function read(){return match (s) {when not " + pattern + ": [s];default: undefined;}}",
		}[variant%3]
		precise := fmt.Sprintf("%s:%d", key, variant)
		nativeType, errors := compileReadDeclaration(t, w, "main.ts", header+native)
		if len(errors) != 0 || nativeType == "" {
			Gap(t, builtinExtractorFlowTypesTarget, "native:"+precise, "the instanceof counterpart fails: %v\n%s", errors, native)
			return
		}
		customType, errors := compileReadDeclaration(t, w, "main.vibe", header+custom)
		if len(errors) != 0 {
			Gap(t, builtinExtractorFlowTypesTarget, "custom:"+precise, "%s: %v\n%s", builtinExtractorFlowRowQuote, errors, custom)
			return
		}
		if customType != nativeType {
			Gap(t, builtinExtractorFlowTypesTarget, "type:"+precise, "%s: %s\nnative: %s\ncustom: %s", builtinExtractorFlowDefaultQuote, custom, nativeType, customType)
			return
		}
		ExpectPending(t, builtinExtractorFlowTypesTarget, "native:"+precise)
		ExpectPending(t, builtinExtractorFlowTypesTarget, "custom:"+precise)
		ExpectPending(t, builtinExtractorFlowTypesTarget, "type:"+precise)
		ExpectPending(t, builtinExtractorFlowTypesTarget, specCorpusKey(t))
	})
}

const fixedExtractorRestCoverageQuote = "covers its case when it is bare, or when its argument list has the required length and every argument pattern is a bare \x60let\x60 or \x60const\x60 binding"

var fixedExtractorRestCases = []struct{ key, subject, pattern, guard, other string }{
	{"Some", "Option.Option<number>", "Option.Some", "Option.isSome", "Option.None"},
	{"ResultSuccess", "Result.Result<number,string>", "Result.Success", "Result.isSuccess", "Result.Failure"},
	{"ResultFailure", "Result.Result<number,string>", "Result.Failure", "Result.isFailure", "Result.Success"},
	{"ExitSuccess", "Exit.Exit<number,string>", "Exit.Success", "Exit.isSuccess", "Exit.Failure"},
	{"ExitFailure", "Exit.Exit<number,string>", "Exit.Failure", "Exit.isFailure", "Exit.Success"},
}
var fixedExtractorRestForms = []struct{ key, arguments string }{
	{"elided", "(...)"}, {"bound", "(let value,...)"}, {"named", "(...let rest)"}, {"optional", "(let value,let extra?)"},
}

// A fixed extractor's rest test always succeeds, so tsc's false branch of the
// module guard is the oracle for default; coverage still needs the bare form.
func FuzzFixedExtractorRestFlow(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("004-match.md"), fixedExtractorRestCoverageQuote) {
		f.Fatalf("fixed pattern coverage rule changed: %q", fixedExtractorRestCoverageQuote)
	}
	var keys []string
	for _, fixed := range fixedExtractorRestCases {
		for _, form := range fixedExtractorRestForms {
			keys = append(keys, fixed.key+"/"+form.key)
			f.Add(fixed.key + "/" + form.key)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) * 31 % len(keys)
			key = keys[index]
		}
		fixed := fixedExtractorRestCases[index/len(fixedExtractorRestForms)]
		form := fixedExtractorRestForms[index%len(fixedExtractorRestForms)]
		header := "import {Option,Result,Exit} from \"effect\";declare const s:" + fixed.subject + ";"
		pattern := fixed.pattern + form.arguments
		if form.key != "optional" {
			native, errors := compileReadDeclaration(t, w, "main.ts", header+"export function read(){if("+fixed.guard+"(s)){return undefined}return [s]}")
			if len(errors) != 0 || native == "" {
				Gap(t, "FuzzFixedExtractorRestFlow", "native:"+key, "the guard counterpart fails: %v", errors)
				return
			}
			custom, errors := compileReadDeclaration(t, w, "main.vibe", header+"export function read(){return match (s) {when "+pattern+": undefined;default: [s];}}")
			if len(errors) != 0 || custom != native {
				Gap(t, "FuzzFixedExtractorRestFlow", "type:"+key, "%s: %s\nnative: %s\ncustom: %s\nerrors: %v", builtinExtractorFlowDefaultQuote, pattern, native, custom, errors)
				return
			}
		}
		_, errors := compileReadDeclaration(t, w, "main.vibe", header+"export function read(){return match (s) {when "+pattern+": 1;when "+fixed.other+": 0;}}")
		if !strings.Contains(strings.Join(errors, "\n"), "4701") {
			Gap(t, "FuzzFixedExtractorRestFlow", "coverage:"+key, "%s: %s reported %v", fixedExtractorRestCoverageQuote, pattern, errors)
			return
		}
		ExpectPending(t, "FuzzFixedExtractorRestFlow", "native:"+key)
		ExpectPending(t, "FuzzFixedExtractorRestFlow", "type:"+key)
		ExpectPending(t, "FuzzFixedExtractorRestFlow", "coverage:"+key)
		ExpectPending(t, "FuzzFixedExtractorRestFlow", specCorpusKey(t))
	})
}
