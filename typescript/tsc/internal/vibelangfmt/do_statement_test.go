package vibelangfmt

import "testing"

func TestFormatDoExpressionStatements(t *testing.T) {
	formatter := dprintFormatter(t)
	for name, source := range map[string]string{
		"top":                 "(do { 1; });\n",
		"function":            "export function read() { (do { 1; }); return 0; }\n",
		"if":                  "if (true) (do { 1; });\n",
		"label":               "mark: (do { 1; });\n",
		"binary":              "(do { 1; }) + 2;\n",
		"member":              "(do { ({ value: 1 }); }).value;\n",
		"jsdoc":               "/** keep */\n(do { 1; });\n",
		"nested":              "(do { (do { 1; }); 2; });\n",
		"nested-value":        "(do { (do { 1; }); });\n",
		"nested-deep-value":   "(do { (do { (do { 1; }); }); });\n",
		"whole-binary":        "(do { 1; } + 2);\n",
		"postfix-member":      "(do { ({ value: 1 }); }).value++;\n",
		"initializer-control": "const value = do { 1; };\n",
		"do-while-control":    "do { 1; } while (false);\n",
	} {
		t.Run(name, func(t *testing.T) {
			once, err := Format("input.vibe", source, formatter)
			if err != nil {
				if projection, encodeErr := encode("input.vibe", source); encodeErr == nil {
					t.Fatalf("%v\nprojection: %s\nforms: %+v", err, projection.text, projection.placeholders)
				}
				t.Fatal(err)
			}
			twice, err := Format("input.vibe", once, formatter)
			if err != nil {
				t.Fatal(err)
			}
			if once != twice {
				t.Fatalf("not idempotent:\n%s\nthen:\n%s", once, twice)
			}
		})
	}
}
