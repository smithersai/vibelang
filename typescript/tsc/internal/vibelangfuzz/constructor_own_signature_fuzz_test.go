package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var constructorOwnSites = []string{"typeof", "identity", "assign", "written", "is", "match"}
var constructorOwnSources = []string{"untagged", "tagged", "other"}

func constructorOwnKeys() []string {
	var keys []string
	for _, source := range constructorOwnSources {
		for _, site := range constructorOwnSites {
			keys = append(keys, source+"/"+site)
		}
	}
	return keys
}

func TestConstructorOwnSignatureQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", ownSignatureQuote, ownSignatureOtherQuote)
	r4Quoted(t, "004-match.md", "a construct signature selects `instanceof`")
}

func TestConstructorOwnSignatureKeys(t *testing.T) {
	for _, key := range constructorOwnKeys() {
		data, err := os.ReadFile(filepath.Join("testdata/fuzz/FuzzConstructorOwnSignature", strings.ReplaceAll(key, "/", "-")))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+key)) {
			t.Fatal(key)
		}
	}
}

func FuzzConstructorOwnSignature(f *testing.F) {
	startShortBudget(f)
	keys := constructorOwnKeys()
	r4Seeds(f, keys)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestConstructorOwnSignatureQuoted(t)
		key := keys[r4Pick(data, keys)]
		parts := strings.Split(key, "/")
		value, self := "Base", "Base"
		if parts[0] == "tagged" {
			value, self = "Tagged", "Tagged"
		}
		if parts[0] == "other" {
			value, self = "Other", "Safe"
		}
		prefix := "import { Base, Tagged, Other, Safe } from \"./foreign.js\"\nconst identity = <T>(x: T): T => x\n"
		body := ""
		switch parts[1] {
		case "typeof":
			body = "export const value: typeof " + self + " = " + value
		case "identity":
			body = "export const value = identity(" + value + ")"
		case "assign":
			body = "export const value = Object.assign({}, { make: " + value + " })"
		case "written":
			body = "export const value: new (n: number) => { n: number } = " + value
		case "is":
			body = "export function test(subject: unknown) { return subject is " + value + " }"
		case "match":
			body = "export function test(subject: unknown) { return match (subject) { when " + value + ": true; default: false; } }"
		}
		library := "export declare class Base { readonly n: number; constructor(n: number) }\n" +
			"export declare class Other { readonly n: number; constructor(n: number) }\n" +
			"export declare class Tagged { readonly n: number;\n/** @throws {RangeError} */\nconstructor(n: number) }\n" +
			"export declare class Safe { readonly n: number;\n/** @throws {never} */\nconstructor(n: number) }\n"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": prefix + body, "foreign.d.ts": library}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got, unexpected := 0, false
		for _, d := range result.Diagnostics {
			if d.Code() == 402 {
				got++
			} else if d.Category() == diagnostics.CategoryError {
				unexpected = true
			}
		}
		want := 0
		if parts[1] == "written" || parts[0] == "other" && parts[1] == "typeof" {
			want = 1
		}
		if got != want || unexpected {
			Gap(t, "FuzzConstructorOwnSignature", key, "own constructor signatures and non-invoking patterns must retain their contract: want %d EK0402 only, got %v", want, SortedKeys(Keys(result.Dir, result.Diagnostics)))
		}
	})
}
