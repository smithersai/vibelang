package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const migrationCallableDataTarget = "FuzzMigrationCallableData"
const migrationCallableDataQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
const migrationCallableKindQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."

func TestMigrationCallableDataQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{"000-intro.md": migrationCallableDataQuote, "001-functions.md": migrationCallableKindQuote} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// Alchemy19/28: an ordinary TypeScript call receives data through a
// non-callable member of a union. Callable constraints and array wrappers
// cannot turn that member into a synchronous callback requirement. The native
// TypeScript source and its Vibe rename are specified to agree on admission.
// An explicit plain return keeps the legacy root-runner issue out of this rule.
func migrationCallableDataPrograms() map[string]string {
	programs := map[string]string{}
	for _, witness := range []string{"required", "optional"} {
		optional := ""
		if witness == "optional" {
			optional = "?"
		}
		lib := "import type { Effect } from \"effect\";\n" +
			"export interface Res<R> { (id:string):Effect.Effect<R>;readonly witness:R }\n" +
			"export interface Like<R> { readonly witness" + optional + ":R }\n" +
			"export interface Plat<R> { (id:string,props:number):any;readonly platform:R }\n" +
			"export declare const Account:Res<number>; export declare const Other:Res<number>;\n" +
			"export declare const DataValue:Like<number>;\n"
		for _, form := range []string{"direct", "inferred", "constrained", "array", "readonly-array", "tuple", "object"} {
			parameters, target, argument := "", "Like<number>|Plat<number>", "Account"
			switch form {
			case "inferred":
				parameters = "<W>"
				target = "Like<W>|Plat<W>"
			case "constrained":
				parameters = "<T extends Like<any>|Plat<any>>"
				target = "T"
			case "array":
				parameters = "<T extends Like<any>|Plat<any>>"
				target = "T[]"
				argument = "[Account,Other]"
			case "readonly-array":
				parameters = "<T extends Like<any>|Plat<any>>"
				target = "ReadonlyArray<T>"
				argument = "[Account,Other]"
			case "tuple":
				parameters = "<T extends Like<any>|Plat<any>>"
				target = "[T]"
				argument = "[Account]"
			case "object":
				parameters = "<T extends Like<any>|Plat<any>>"
				target = "{item:T}"
				argument = "{item:Account}"
			}
			for _, value := range []string{"callable", "data"} {
				arg := argument
				if value == "data" {
					arg = strings.ReplaceAll(arg, "Account", "DataValue")
					arg = strings.ReplaceAll(arg, "Other", "DataValue")
				}
				helper := lib + "/** @throws {never} */\nexport declare function register" + parameters + "(input:" + target + "):string;\n"
				source := "import { Account, Other, DataValue, register } from \"./lib.js\";\nexport function probe():string {return register(" + arg + ")}\n"
				programs[witness+":"+form+":"+value] = Archive(map[string]string{"lib.ts": helper, "main.ts": source})
			}
		}
	}
	for _, callback := range []struct{ key, returns string }{
		{"positive:effect-callback", "Effect.Effect<number>"},
		{"negative:plain-callback", "number"},
	} {
		helper := "import type { Effect } from \"effect\";\nexport interface Res { (id:string):Effect.Effect<number>; readonly witness:number }\nexport declare const Account:Res;\n/** @throws {never} */\nexport declare function register(input:(id:string)=>" + callback.returns + "):string;\n"
		source := "import { Account, register } from \"./lib.js\";\nexport function probe():string {return register(Account)}\n"
		programs[callback.key] = Archive(map[string]string{"lib.ts": helper, "main.ts": source})
	}
	return programs
}

// Keep fuzz mutations inside this rule's ordinary-TypeScript neighbourhood.
// Arbitrary valid TypeScript may use a platform global that a VIP deliberately
// forbids in VibeLang; it would not be an admission counterpart for this test.
func migrationCallableDataNested(archive string, depth uint8) string {
	files := Unarchive(archive)
	for range depth {
		lib := files["lib.ts"]
		start := strings.Index(lib, "(input:") + len("(input:")
		end := strings.LastIndex(lib, "):string;")
		if start < len("(input:") || end < start {
			panic("invalid callable-data helper template")
		}
		files["lib.ts"] = lib[:start] + "ReadonlyArray<" + lib[start:end] + ">" + lib[end:]
		source := files["main.ts"]
		start = strings.Index(source, "return register(") + len("return register(")
		end = strings.LastIndex(source, ")}\n")
		if start < len("return register(") || end < start {
			panic("invalid callable-data call template")
		}
		files["main.ts"] = source[:start] + "[" + source[start:end] + "]" + source[end:]
	}
	return Archive(files)
}

func FuzzMigrationCallableData(f *testing.F) {
	startShortBudget(f)
	programs := migrationCallableDataPrograms()
	keys := []string{}
	for key := range programs {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	for _, key := range []string{"required:array:callable", "optional:inferred:callable", "negative:plain-callback"} {
		for _, depth := range []uint8{1, 2, 3} {
			f.Add(key, depth)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, depth uint8) {
		TestMigrationCallableDataQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		depth %= 4
		archive := migrationCallableDataNested(programs[key], depth)
		project := ProjectFromArchive(archive)
		if Admissible(project) != "" {
			return
		}
		source, ok := project.Files["main.ts"]
		if !ok {
			return
		}
		var before, after *Result
		var err error
		within(t, "check TypeScript callable data", func() { before, err = w.Compile(t.Context(), project) })
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		referenceRejects := HasError(before.Diagnostics)
		if referenceRejects != strings.HasPrefix(key, "negative:") {
			t.Fatalf("invalid TypeScript control: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), archive)
		}
		files := map[string]string{}
		for name, text := range project.Files {
			files[name] = text
		}
		delete(files, "main.ts")
		files["main.vibe"] = source
		project.Files = files
		within(t, "check Vibe callable data", func() { after, err = w.Compile(t.Context(), project) })
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if depth > 0 {
			key += fmt.Sprintf(":depth:%d", depth)
		}
		kind := "accept:"
		if referenceRejects {
			kind = "reject:"
		}
		if HasError(after.Diagnostics) != referenceRejects {
			Gap(t, migrationCallableDataTarget, kind+key, "Chapters0/1: %q; %q. The TypeScript counterpart and Vibe rename disagree on call admission; Vibe diagnostics %v\n%s", migrationCallableDataQuote, migrationCallableKindQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), archive)
		}
		ExpectPending(t, migrationCallableDataTarget, kind+key)
		ExpectPending(t, migrationCallableDataTarget, specCorpusKey(t))
	})
}
