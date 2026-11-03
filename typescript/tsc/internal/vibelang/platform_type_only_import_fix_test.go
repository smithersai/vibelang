package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const platformTypeOnlyAmbient = `declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> { run<R>(store: T, f: () => R): R }
  export class AsyncResource { id: number }
  const defaultValue: { version: string }
  export default defaultValue
}
`

// fixPlatformTypeOnly returns what --fix writes for source, or source itself.
func fixPlatformTypeOnly(t *testing.T, source string) string {
	t.Helper()
	dir := t.TempDir()
	for name, text := range map[string]string{
		"package.json":  `{"name":"platform-type-only","type":"module"}`,
		"tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","skipLibCheck":true,"noEmit":true,"types":[],"verbatimModuleSyntax":true},"files":["main.vibe","node.d.ts"]}`,
		"main.vibe":     source,
		"node.d.ts":     platformTypeOnlyAmbient,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if len(result.Refused) != 0 {
		t.Fatalf("refused: %+v", result.Refused)
	}
	for _, fixed := range result.Files {
		return fixed.Text
	}
	return source
}

func TestPlatformTypeOnlyImportFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"class read as a type",
			"import { AsyncLocalStorage } from \"node:async_hooks\"\nexport type C = AsyncLocalStorage<unknown>\n",
			"import type { AsyncLocalStorage } from \"node:async_hooks\"\nexport type C = AsyncLocalStorage<unknown>\n"},
		{"one alias",
			"import { AsyncResource as R } from \"node:async_hooks\"\nexport type C = R\n",
			"import type { AsyncResource as R } from \"node:async_hooks\"\nexport type C = R\n"},
		{"two bindings",
			"import { AsyncLocalStorage, AsyncResource as R } from \"node:async_hooks\"\nexport type C = AsyncLocalStorage<R>\n",
			"import type { AsyncLocalStorage, AsyncResource as R } from \"node:async_hooks\"\nexport type C = AsyncLocalStorage<R>\n"},
		{"inline type keyword",
			"import { type AsyncLocalStorage, AsyncResource } from \"node:async_hooks\"\nexport type C = AsyncLocalStorage<AsyncResource>\n",
			"import type { AsyncLocalStorage, AsyncResource } from \"node:async_hooks\"\nexport type C = AsyncLocalStorage<AsyncResource>\n"},
		{"namespace",
			"import * as Hooks from \"node:async_hooks\"\nexport type C = Hooks.AsyncLocalStorage<unknown>\n",
			"import type * as Hooks from \"node:async_hooks\"\nexport type C = Hooks.AsyncLocalStorage<unknown>\n"},
		{"typeof is erased",
			"import { AsyncResource } from \"node:async_hooks\"\nexport type C = typeof AsyncResource\n",
			"import type { AsyncResource } from \"node:async_hooks\"\nexport type C = typeof AsyncResource\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := fixPlatformTypeOnly(t, test.source); got != test.want {
				t.Fatalf("got:\n%s\nwant:\n%s", got, test.want)
			}
		})
	}
}

// A value read keeps the import and its EK4402, whatever else reads it as a type.
func TestPlatformTypeOnlyImportFixLeaves(t *testing.T) {
	for name, source := range map[string]string{
		"new":               "import { AsyncResource } from \"node:async_hooks\"\nexport const r = new AsyncResource()\n",
		"both":              "import { AsyncResource } from \"node:async_hooks\"\nexport const r: AsyncResource = new AsyncResource()\n",
		"one of two":        "import { AsyncLocalStorage, AsyncResource } from \"node:async_hooks\"\nexport type C = AsyncLocalStorage<unknown>\nexport const r = new AsyncResource()\n",
		"re-export":         "import { AsyncResource } from \"node:async_hooks\"\nexport { AsyncResource }\n",
		"shorthand":         "import { AsyncResource } from \"node:async_hooks\"\nexport const o = { AsyncResource }\n",
		"default and named": "import d, { AsyncResource } from \"node:async_hooks\"\nexport type C = typeof d | AsyncResource\n",
		"in a closure":      "import { AsyncResource } from \"node:async_hooks\"\nexport const f = () => AsyncResource\n",
	} {
		t.Run(name, func(t *testing.T) {
			if got := fixPlatformTypeOnly(t, source); got != source {
				t.Fatalf("--fix wrote:\n%s", got)
			}
		})
	}
}
