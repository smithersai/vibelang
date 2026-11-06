package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const ownBooleanTypesTarget = "FuzzOwnBooleanClassPatterns"
const ownBooleanRowQuote = "A boolean-returning custom matcher establishes no narrowing"
const ownBooleanDefaultQuote = ownBooleanRowQuote

func ownBooleanQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{ownBooleanRowQuote, ownBooleanDefaultQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			tb.Fatalf("class pattern typing rule changed: %q", quote)
		}
	}
}

func TestOwnBooleanClassPatternsQuoted(t *testing.T) { ownBooleanQuotes(t) }

var ownBooleanClasses = []struct{ key, class string }{
	{"OwnBoolean", "OwnBoolean"}, {"OwnPlain", "OwnPlain"}, {"OwnTrue", "OwnTrue"}, {"OwnFalse", "OwnFalse"}, {"OwnGetter", "OwnGetter"},
}

var ownBooleanSubjects = []struct{ key, subject string }{
	{"unknown", "unknown"}, {"any", "any"}, {"object", "object"},
	{"declared", "Plain | Box<number> | string"}, {"derived", "Base | Named<\"a\"> | number"},
	{"library", "Promise<number> | Map<string, number> | Set<boolean> | Date | null"},
}

const ownBooleanDeclarations = "import {customMatcher as key} from \"vibelang-runtime\";export class Plain {readonly id=1};export class Box<T> {constructor(readonly value:T){}};export class Base {readonly base=1};export class Named<T extends string> extends Box<T> {};" +
	"export class OwnBoolean {readonly value=4;static [Symbol.hasInstance](s:unknown):s is string{return typeof s===\"string\"};static [key](s:unknown):boolean{return typeof s===\"number\"}};" +
	"export class OwnPlain {readonly value=4;static [key](s:unknown):boolean{return typeof s===\"number\"}};" +
	"export class OwnTrue {readonly value=4;static [key](s:unknown):boolean{return true}};" +
	"export class OwnFalse {readonly value=4;static [key](s:unknown):boolean{return false}};" +
	"export class OwnGetter {readonly value=4;static get [key](){return (s:unknown):boolean=>typeof s===\"number\"}};"

// The own matcher invocation is the TypeScript counterpart. Compare the
// subject type left in each branch, without a constructor-based assertion.
func FuzzOwnBooleanClassPatterns(f *testing.F) {
	startShortBudget(f)
	ownBooleanQuotes(f)
	var keys []string
	for _, class := range ownBooleanClasses {
		for _, subject := range ownBooleanSubjects {
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
		class := ownBooleanClasses[index/len(ownBooleanSubjects)]
		subject := ownBooleanSubjects[index%len(ownBooleanSubjects)]
		variant %= 3
		header := ownBooleanDeclarations + fmt.Sprintf("declare const s:%s;", subject.subject)
		test := class.class + "[key](s)"
		native := []string{
			"export function read(){if(" + test + "){return [s]}return undefined}",
			"export function read(){if(" + test + "){return undefined}return [s]}",
			"export function read(){if(!(" + test + ")){return [s]}return undefined}",
		}[variant]
		custom := []string{
			"export function read(){return match (s) {when " + class.class + ": [s];default: undefined;}}",
			"export function read(){return match (s) {when " + class.class + ": undefined;default: [s];}}",
			"export function read(){return match (s) {when not " + class.class + ": [s];default: undefined;}}",
		}[variant]
		compile := func(file, source string) (string, []string) {
			config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2023\",\"DOM\"],\"module\":\"NodeNext\",\"strict\":true,\"declaration\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"" + file + "\"]}"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				}
			}
			for name, output := range r.Outputs {
				if strings.HasSuffix(name, ".d.ts") {
					for line := range strings.SplitSeq(output, "\n") {
						if strings.HasPrefix(line, "export declare function read") {
							return line, errors
						}
					}
				}
			}
			return "", errors
		}
		precise := fmt.Sprintf("%s:%d", key, variant)
		nativeType, errors := compile("main.ts", header+native)
		if len(errors) != 0 || nativeType == "" {
			Gap(t, ownBooleanTypesTarget, "native:"+precise, "the instanceof counterpart fails: %v\n%s", errors, native)
			return
		}
		customType, errors := compile("main.vibe", header+custom)
		if len(errors) != 0 {
			Gap(t, ownBooleanTypesTarget, "custom:"+precise, "%s: %v\n%s", ownBooleanRowQuote, errors, custom)
			return
		}
		if customType != nativeType {
			Gap(t, ownBooleanTypesTarget, "type:"+precise, "%s: %s\nnative: %s\ncustom: %s", ownBooleanDefaultQuote, custom, nativeType, customType)
			return
		}
		ExpectPending(t, ownBooleanTypesTarget, "native:"+precise)
		ExpectPending(t, ownBooleanTypesTarget, "custom:"+precise)
		ExpectPending(t, ownBooleanTypesTarget, "type:"+precise)
		ExpectPending(t, ownBooleanTypesTarget, specCorpusKey(t))
	})
}
