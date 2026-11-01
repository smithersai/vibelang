package vibelangfuzz

import "testing"

func TestSpecifierWrittenJSX(t *testing.T) {
	TestNativeOutputSpecifierRulesQuoted(t)
	for _, statement := range []string{
		"import { token } from './token.tsx'",
		"export { token } from './token.tsx'",
		"type Token = import('./token.tsx').Token",
		"const load = () => import('./token.tsx')",
		"const load = require('./token.tsx')",
	} {
		if !specifierWritten("./token.jsx", sourceSpecifiers("main.vibe", statement)) {
			t.Errorf("native JSX output lost its written import: %s", statement)
		}
	}
	if !specifierWritten("./token%20name.jsx", map[string]bool{"./token name.tsx": true}) {
		t.Error("URL escaping lost the native JSX source")
	}
	for _, source := range []string{"./token.ts", "./token.vibe", "./other.tsx", "./token.mts", "./token.cts"} {
		if specifierWritten("./token.jsx", map[string]bool{source: true}) {
			t.Errorf("%s cannot authorize ./token.jsx", source)
		}
	}
	if specifierWritten("./token.jsx", sourceSpecifiers("main.vibe", "const text = './token.tsx'")) {
		t.Error("an ordinary string authorized a JSX import")
	}
}
