package compiler

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestSidecarTextNamesVibeModuleEverywhereADeclarationNamesOne(t *testing.T) {
	t.Parallel()
	exists := func(path string) bool { return path == "/src/user.vibe" }
	for _, test := range []struct{ name, declaration, want string }{
		{"import", `import { User } from "./user.js";`, `import { User } from "./user.vibe";`},
		{"re-export", `export * from "./user.js";`, `export * from "./user.vibe";`},
		{"import type", `export type U = import("./user.js").User;`, `export type U = import("./user.vibe").User;`},
		{"require", `import user = require("./user.js");`, `import user = require("./user.vibe");`},
		{"augmentation", "declare module \"./user.js\" {\n}", "declare module \"./user.vibe\" {\n}"},
		{"a TypeScript module stays", `export * from "./other.js";`, `export * from "./other.js";`},
		{"a string type stays", `export declare const path: "./user.js";`, `export declare const path: "./user.js";`},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := sidecarText(test.declaration, "/out/index.d.ts", "/src/index.vibe", exists, tspath.CaseSensitive)
			if got != test.want {
				t.Fatalf("sidecarText(%q) = %q, want %q", test.declaration, got, test.want)
			}
		})
	}
}
