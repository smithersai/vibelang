package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const clockReceiverQuote = "A member of a value the code was given"

func clockReceiverQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("005-services.md"), clockReceiverQuote) {
		t.Fatal("supplied platform receiver rule moved")
	}
}
func TestClockReceiverOriginQuoted(t *testing.T) { clockReceiverQuoted(t) }

func FuzzClockReceiverOrigin(f *testing.F) {
	startShortBudget(f)
	clockReceiverQuoted(f)
	apis := []string{"performance", "uuid", "random-values"}
	origins := []string{"parameter", "nested", "import", "service", "method", "global", "globalThis", "host-alias"}
	var keys []string
	for _, api := range apis {
		for _, origin := range origins {
			key := api + ":" + origin
			keys = append(keys, key)
			for _, data := range [][]byte{{0, 0, 0, 0}, {1, 1, 1, 1}, {2, 2, 2, 2}, {3, 3, 3, 3}, {255, 255, 255, 255}} {
				f.Add(key, data)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		pick := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		known := false
		for _, k := range keys {
			if key == k {
				known = true
				break
			}
		}
		if !known {
			key = keys[int(pick(0))%len(keys)]
		}
		api, origin, _ := strings.Cut(key, ":")
		typ, global, member, args := "Performance", "performance", "now", ""
		if api != "performance" {
			typ, global = "Crypto", "crypto"
			member = "randomUUID"
		}
		if api == "random-values" {
			member, args = "getRandomValues", "new Uint8Array(2)"
		}
		receiver, prefix := "input", ""
		files := map[string]string{"package.json": servicesPackage}
		head := "export function read(input:" + typ + ")"
		host := false
		switch origin {
		case "nested":
			receiver = "input.value"
			head = "export function read(input:{value:" + typ + "})"
		case "import":
			prefix = "import {input} from \"./native.js\";"
			head = "export function read()"
			files["native.ts"] = "export declare const input:" + typ + ";"
		case "service":
			prefix = "import {Effect} from \"effect\";service Input {static readonly key=\"test/Input\";value:" + typ + "};"
			head = "export effect function read()"
			receiver = "(try Input).value"
		case "method":
			head = "export function read(input:" + typ + "[\"" + member + "\"])"
		case "global":
			receiver = global
			head = "export function read()"
			host = true
		case "globalThis":
			receiver = "globalThis." + global
			head = "export function read()"
			host = true
		case "host-alias":
			prefix = "const input=" + global + ";"
			head = "export function read()"
			host = true
		}
		switch pick(0) % 4 {
		case 1:
			receiver = "(" + receiver + ")"
		case 2:
			receiver = "(" + receiver + " as " + typ + ")"
		case 3:
			receiver = "(" + receiver + "!)"
		}
		access := receiver + "." + member
		switch pick(1) % 3 {
		case 1:
			access = receiver + "[\"" + member + "\"]"
		case 2:
			access = receiver + "[\x60" + member + "\x60]"
		}
		if origin == "method" {
			access = "input"
		}
		call := access + "(" + args + ")"
		if pick(2)%2 != 0 {
			call = access + "?.(" + args + ")"
		}
		source := prefix + head + "{return " + call + "}"
		if origin == "service" {
			source = prefix + head + "{const input=(try Input).value;return try Effect.try(()=>" + strings.ReplaceAll(call, "(try Input).value", "input") + ")}"
		}
		name := "main.vibe"
		if pick(3)%2 != 0 {
			name = "main.vibex"
		}
		config := func(file string, prelude bool) string {
			settings := ""
			if !prelude {
				settings = ",\"vibe\":{\"effectGlobals\":false,\"effectModules\":false}"
			}
			return fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"module\":\"NodeNext\",\"target\":\"ES2022\",\"types\":[],\"noEmit\":true},\"files\":[%q]%s}", file, settings)
		}
		files[name] = source
		result, err := w.Compile(t.Context(), Project{Config: config(name, pick(3)%4 < 2), Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		banned := false
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 4402 {
				banned = true
				continue
			}
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzClockReceiverOrigin", key, "unexpected diagnostic: %s; source %s", d.String(), source)
			}
		}
		if banned != host {
			Gap(t, "FuzzClockReceiverOrigin", key, "%s: want host=%t, got %v; source %s", clockReceiverQuote, host, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		if origin != "service" {
			delete(files, name)
			files["main.ts"] = source
			native, err := w.Compile(t.Context(), Project{Config: config("main.ts", true), Files: files})
			if err != nil {
				t.Fatal(err)
			}
			defer native.Remove()
			for _, d := range native.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("native TypeScript control: %s; source %s", d.String(), source)
				}
			}
		}
	})
}
