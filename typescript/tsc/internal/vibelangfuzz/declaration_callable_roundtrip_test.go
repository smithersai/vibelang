package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const callableRoundTripTarget = "FuzzDeclarationCallableRoundTrip"
const callableRoundTripQuote = "Tags attach to call signatures: each overload and a returned callable's own signature carry their own."

func TestDeclarationCallableRoundTripQuoted(t *testing.T) {
	chapterSays(t, "003-failures.md", callableRoundTripQuote)
	chapterSays(t, "003-failures.md", "Declaration output records "+string(rune(96))+"@throws {never}"+string(rune(96))+" on non-effectful signatures, not an inferred contract")
}

func FuzzDeclarationCallableRoundTrip(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	keys := []string{"alias", "conditional", "indexed", "nested"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(3))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		t.Parallel()
		TestDeclarationCallableRoundTripQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "foldkit-callable-declaration-roundtrip.json"))
		if err != nil {
			t.Fatal(err)
		}
		var corpus struct{ Source, Quote string }
		if err := json.Unmarshal(raw, &corpus); err != nil {
			t.Fatal(err)
		}
		if corpus.Source == "" || corpus.Quote != callableRoundTripQuote {
			t.Fatal("invalid callable corpus")
		}
		producer := corpus.Source
		switch key {
		case "conditional":
			producer = strings.Replace(producer, "type F = (value: number) => number;", "type C<T extends boolean> = T extends true ? (value: number) => number : () => number;\nexport type F = C<true>;", 1)
		case "indexed":
			producer = strings.Replace(producer, "type F = (value: number) => number;", "type Functions = { callback: (value: number) => number };\nexport type F = Functions[\"callback\"];", 1)
		case "nested":
			producer = strings.Replace(producer, "type F = (value: number) => number;", "type F = ((value: number) => number);", 1)
		}
		consumer := "export effect function run() { return make()(1) }\n"
		if mode&1 != 0 {
			producer = strings.ReplaceAll(producer, "number", "string")
			consumer = strings.Replace(consumer, "(1)", "(\"value\")", 1)
		}
		config := func(entry string, emit bool) string {
			return fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"types\":[],\"skipLibCheck\":true,\"declaration\":%t,\"emitDeclarationOnly\":%t,\"outDir\":\"out\"},\"files\":[%q]}", emit, emit, entry)
		}
		compile := func(files map[string]string, entry string, emit bool) (string, []string) {
			files["package.json"] = "{\"type\":\"module\"}"
			result, err := w.Compile(t.Context(), Project{Files: files, Config: config(entry, emit)})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			codes := []string{}
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, diagnosticCodeName(d.Source(), d.Code()))
				}
			}
			for path, text := range result.Outputs {
				if strings.HasSuffix(path, "/producer.d.ts") {
					return text, codes
				}
			}
			return "", codes
		}
		emitted, codes := compile(map[string]string{"producer.vibe": producer}, "producer.vibe", true)
		if len(codes) != 0 || emitted == "" {
			t.Fatalf("invalid producer: %v\n%s", codes, emitted)
		}
		_, codes = compile(map[string]string{"producer.vibe": producer, "main.vibe": "import { make } from \"./producer.vibe\"\n" + consumer}, "main.vibe", false)
		if len(codes) != 0 {
			t.Fatalf("native-import control: %v", codes)
		}
		reloaded := func(declaration string) []string {
			_, codes := compile(map[string]string{"producer.d.ts": declaration, "main.vibe": "import { make } from \"./producer.js\"\n" + consumer}, "main.vibe", false)
			return codes
		}
		trivia := " \n"
		if mode&2 != 0 {
			trivia = "\r\n\t"
		}
		newline := strings.ReplaceAll(emitted, "/** @throws", trivia+"/** @throws")
		withoutSpace := func(text string) string {
			return strings.Map(func(r rune) rune {
				if unicode.IsSpace(r) {
					return -1
				}
				return r
			}, text)
		}
		if withoutSpace(newline) != withoutSpace(emitted) {
			t.Fatal("trivia control changed declaration tokens")
		}
		if codes := reloaded(newline); len(codes) != 0 {
			t.Fatalf("newline-attached contract control: %v\n%s", codes, newline)
		}
		value := "number"
		if mode&1 != 0 {
			value = "string"
		}
		unsafe := "export declare const make: {\n/** @throws {never} */\n(): {\n/** @throws {RangeError} */\n(value: " + value + "): " + value + "\n}\n};\n"
		codes = reloaded(unsafe)
		if len(codes) != 1 || !strings.Contains(codes[0], "EK0403") {
			t.Fatalf("throwing returned-callable control: %v", codes)
		}
		codes = reloaded(emitted)
		if len(codes) != 0 {
			for _, code := range codes {
				if !strings.Contains(code, "EK0403") {
					t.Fatalf("unrelated declaration refusal: %v", codes)
				}
			}
			Gap(t, callableRoundTripTarget, "shape:"+key, "Chapter 003: %s; unchanged emitted callable contract was lost: %v\n%s", callableRoundTripQuote, codes, emitted)
		}
		ExpectPending(t, callableRoundTripTarget, "shape:"+key)
		ExpectPending(t, callableRoundTripTarget, specCorpusKey(t))
	})
}
