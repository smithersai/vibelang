package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentAnyTarget = "FuzzConcurrentAnyBinding"
const concurrentAnyQuote = "The head is a `const` or `let` declaration, destructuring included: ECMAScript's `ForDeclaration`, `LetOrConst ForBinding` (VIP-19, amended)."

func TestConcurrentAnyBindingQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), concurrentAnyQuote) {
		t.Fatalf("stale native head quote: %s", concurrentAnyQuote)
	}
}

func FuzzConcurrentAnyBinding(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), concurrentAnyQuote) {
		f.Fatal("stale native head quote")
	}
	rules := []struct {
		key, prefix, generic, params, setup, head, items, body string
		code                                                   int32
	}{
		{"direct", "", "", "rows:any", "", "item", "rows", "const checked:number=item.n;void checked", 0},
		{"alias", "type Rows=any;", "", "rows:Rows", "", "item", "rows", "const checked:number=item.n;void checked", 0},
		{"assertion", "", "", "rows:unknown", "", "item", "(rows as any)", "const checked:number=item.n;void checked", 0},
		{"generic-any", "", "<T extends Iterable<any>>", "rows:T", "", "item", "rows", "const checked:number=item.n;void checked", 0},
		{"whole-value", "", "", "rows:any", "", "item", "rows", "const checked:number=item;void checked", 0},
		{"head-name", "", "", "rows:Array<{n:number}>", "", "$concurrentItem", "rows", "const checked:number=$concurrentItem.n;void checked", 0},
		{"outer-name", "", "", "rows:Array<{n:number}>", "const $concurrentItem=9;", "item", "rows", "const outside:number=$concurrentItem;const checked:number=item.n;void outside;void checked", 0},
		{"shadow", "", "", "rows:any", "", "item", "rows", "const item=1;const checked:number=item;void checked", 0},
		{"narrow-string", "", "", "rows:any", "", "item", "rows", "if(typeof item==='string'){const checked:number=item;void checked}", 2322},
		{"narrow-number", "", "", "rows:any", "", "item", "rows", "if(typeof item==='number'){const checked:string=item;void checked}", 2322},
		{"typed", "", "", "rows:number[]", "", "item", "rows", "const checked:number=item.n;void checked", 2339},
		{"generic-typed", "", "<T extends Iterable<number>>", "rows:T", "", "item", "rows", "const checked:number=item.n;void checked", 2339},
		{"unknown-item", "", "", "rows:Iterable<unknown>", "", "item", "rows", "const checked:number=item.n;void checked", 18046},
		{"unknown-operand", "", "", "rows:unknown", "", "item", "rows", "void item", 1901},
	}
	for _, r := range rules {
		f.Add(r.key)
		f.Add(r.key + ":let-bound")
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		base, tail, _ := strings.Cut(key, ":")
		i := slices.IndexFunc(rules, func(r struct {
			key, prefix, generic, params, setup, head, items, body string
			code                                                   int32
		}) bool {
			return r.key == base
		})
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		row := rules[i]
		kind, limit := "const", ""
		if tail != "" {
			kind, limit = "let", "(1)"
		}
		depth := len(tail) % 4
		items := strings.Repeat("(", depth) + row.items + strings.Repeat(")", depth)
		source := fmt.Sprintf("%s export effect function main%s(%s){%s for concurrent%s(%s %s of %s){%s}}", row.prefix, row.generic, row.params, row.setup, limit, kind, row.head, items, row.body)
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := 0
		matches := 0
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors++
				if d.Code() == row.code {
					matches++
				}
			}
		}
		if row.code == 0 && errors != 0 || row.code != 0 && (errors != 1 || matches != 1) {
			Gap(t, concurrentAnyTarget, "type:"+row.key+":"+kind, "%s; native binding %s expects code %d\n%s\n%v", concurrentAnyQuote, row.key, row.code, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, concurrentAnyTarget, "type:"+row.key+":"+kind)
	})
}

func FuzzConcurrentUnusedHead(f *testing.F) {
	startShortBudget(f)
	keys := []string{"const-unused", "let-unused", "const-used", "let-used", "body-local"}
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		if !strings.Contains(SpecText("002-running.md"), concurrentAnyQuote) {
			t.Fatal("stale native head quote")
		}
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		kind, body := "const", ""
		if i == 1 || i == 3 {
			kind = "let"
		}
		if i == 2 || i == 3 {
			body = "void _item"
		}
		if i == 4 {
			body = "const _local=1"
		}
		source := fmt.Sprintf("export effect function main(rows:number[]){for concurrent(%s _item of rows){%s}}", kind, body)
		parameters := len(key)%2 == 0
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noUnusedLocals":true,"noUnusedParameters":%t,"types":[]},"files":["main.vibe"]}`, parameters)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes []int32
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		wanted := 0
		if i == 4 {
			wanted = 1
		}
		if len(codes) != wanted || wanted == 1 && codes[0] != 6133 {
			Gap(t, "FuzzConcurrentUnusedHead", keys[i], "%s; native unused-head diagnostics differ: %v\n%s", concurrentAnyQuote, codes, source)
		}
		ExpectPending(t, "FuzzConcurrentUnusedHead", keys[i])
	})
}

func TestConcurrentUnusedHeadQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), concurrentAnyQuote) {
		t.Fatal("stale native head quote")
	}
}

func FuzzConcurrentUnusedHeadFix(f *testing.F) {
	startShortBudget(f)
	keys := []string{"const", "let", "collision", "rhs-capture", "shadow", "body-local"}
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		if !strings.Contains(SpecText("002-running.md"), concurrentAnyQuote) {
			t.Fatal("stale native head quote")
		}
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		source := "export effect function main(rows:number[]){for concurrent(const item of rows){}}"
		want := strings.Replace(source, "const item", "const _item", 1)
		switch i {
		case 1:
			source = strings.Replace(source, "const item", "let item", 1)
			want = strings.Replace(source, "let item", "let _item", 1)
		case 2:
			source = "export effect function main(rows:number[]){const _item=1;for concurrent(let item of rows){void _item}}"
			want = strings.Replace(source, "let item", "let _item2", 1)
		case 3:
			source = "export effect function main(rows:number[]){let read:()=>unknown=()=>0;for concurrent(const item of (read=()=>item,rows)){};return read}"
			want = source
		case 4:
			source = "export effect function main(rows:number[]){for concurrent(const item of rows){const item=1;void item}}"
			want = source
		case 5:
			source = "export effect function main(rows:number[]){for concurrent(const item of rows){void item;const _local=1}}"
			want = source
		}
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noUnusedLocals":true,"types":[]},"files":["main.vibe"]}`
		files := map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}
		before, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		got := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				got = file.Text
			}
		}
		if got != want {
			Gap(t, "FuzzConcurrentUnusedHeadFix", keys[i], "%s; unsafe or missing unused-head repair\nwant %s\ngot %s", concurrentAnyQuote, want, got)
		}
		if i < 3 {
			files["main.vibe"] = got
			after, err := w.Compile(t.Context(), Project{Files: files, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer after.Remove()
			for _, d := range after.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzConcurrentUnusedHeadFix", keys[i], "%s; repaired source rejected: %s", concurrentAnyQuote, d.String())
				}
			}
		}
		ExpectPending(t, "FuzzConcurrentUnusedHeadFix", keys[i])
	})
}
