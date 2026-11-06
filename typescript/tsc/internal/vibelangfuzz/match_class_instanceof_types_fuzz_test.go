package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const classInstanceofTypesTarget = "FuzzClassPatternInstanceofTypes"
const classInstanceofRowQuote = "| ordinary class \x60C\x60 without an own matcher | \x60s instanceof C\x60 |"
const classInstanceofDefaultQuote = "a \x60default\x60 arm follows TypeScript control flow after every preceding ordered pattern and guard test has failed"

func classInstanceofQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{classInstanceofRowQuote, classInstanceofDefaultQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			tb.Fatalf("class pattern typing rule changed: %q", quote)
		}
	}
}

func TestClassPatternInstanceofTypesQuoted(t *testing.T) { classInstanceofQuotes(t) }

var classInstanceofClasses = []struct{ key, class string }{
	{"OwnRoute", "OwnRoute"}, {"InheritedRoute", "InheritedRoute"}, {"Plain", "Plain"}, {"Box", "Box"}, {"Named", "Named"}, {"Base", "Base"},
	{"Promise", "Promise"}, {"Map", "Map"}, {"Set", "Set"}, {"WeakMap", "WeakMap"}, {"WeakRef", "WeakRef"}, {"Date", "Date"}, {"HasText", "HasText"}, {"EmptyCtor", "EmptyCtor"}, {"ObjectCtor", "ObjectCtor"}, {"GenericCtor", "GenericCtor"}, {"Object", "Object"},
}

var classInstanceofSubjects = []struct{ key, subject string }{
	{"unknown", "unknown"}, {"any", "any"}, {"object", "object"},
	{"declared", "Plain | Box<number> | string"}, {"derived", "Base | Named<\"a\"> | number"},
	{"library", "Promise<number> | Map<string, number> | Set<boolean> | Date | null"},
}

const classInstanceofDeclarations = "import {customMatcher as key} from \"vibelang-runtime\";export class OwnRoute {readonly value=4;static [Symbol.hasInstance](s:unknown):s is string{return typeof s===\"string\"};static [key](s:unknown):s is OwnRoute{return typeof s===\"object\"&&s!==null&&\"value\" in s}};export class InheritedRoute extends OwnRoute {};" + "export class Plain {readonly id=1};" +
	"export class Box<T> {constructor(readonly value:T){}};" +
	"export class Base {readonly base=1};" +
	"export class Named<T extends string> extends Box<T> {};" +
	"export class HasText {static [Symbol.hasInstance](value:unknown):value is string{return typeof value === \"string\"}};export declare const EmptyCtor:new()=>{};export declare const ObjectCtor:new()=>{id:number};export declare const GenericCtor:new<T>()=>Box<T>;"

// tsc's declaration of the narrowed value is the oracle: the spec's counterpart
// is the instanceof test, so each program returns what its branch leaves on s.
func FuzzClassPatternInstanceofTypes(f *testing.F) {
	startShortBudget(f)
	classInstanceofQuotes(f)
	var keys []string
	for _, class := range classInstanceofClasses {
		for _, subject := range classInstanceofSubjects {
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
		class := classInstanceofClasses[index/len(classInstanceofSubjects)]
		subject := classInstanceofSubjects[index%len(classInstanceofSubjects)]
		variant %= 3
		header := classInstanceofDeclarations + fmt.Sprintf("declare const s:%s;", subject.subject)
		test := "s instanceof " + class.class
		if class.key == "OwnRoute" {
			test = class.class + "[key](s)"
		}
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
			Gap(t, classInstanceofTypesTarget, "native:"+precise, "the instanceof counterpart fails: %v\n%s", errors, native)
			return
		}
		customType, errors := compile("main.vibe", header+custom)
		if len(errors) != 0 {
			Gap(t, classInstanceofTypesTarget, "custom:"+precise, "%s: %v\n%s", classInstanceofRowQuote, errors, custom)
			return
		}
		if customType != nativeType {
			Gap(t, classInstanceofTypesTarget, "type:"+precise, "%s: %s\nnative: %s\ncustom: %s", classInstanceofDefaultQuote, custom, nativeType, customType)
			return
		}
		ExpectPending(t, classInstanceofTypesTarget, "native:"+precise)
		ExpectPending(t, classInstanceofTypesTarget, "custom:"+precise)
		ExpectPending(t, classInstanceofTypesTarget, "type:"+precise)
		ExpectPending(t, classInstanceofTypesTarget, specCorpusKey(t))
	})
}
