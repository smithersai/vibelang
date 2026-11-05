package parser_test

import "testing"

func TestEffectExtraSlotRecovery(t *testing.T) {
	for _, source := range []string{
		"type X = number!!string!boolean",
		"declare const x: number!!string!boolean",
		"type X = { value: number!!string!boolean }",
		"type X = () => number!!string!boolean",
		"// café 😀\ntype X = number!!string /* channel */ !boolean",
		"declare const x: unknown; const y = x as number!!string!boolean",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			ds := file.Diagnostics()
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 302 {
				t.Fatalf("want only EK0302: %s: %v", source, ds)
			}
		})
	}
	for _, source := range []string{
		"type X = (number!!string)!boolean",
		"type X = number!(string!boolean)",
		"declare const x: unknown; const y = (x as number!!)!",
		"declare const flag: boolean; type X = number!!string\n!flag",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parseVibe(t, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("grouped or newline control: %s: %v", source, ds)
			}
		})
	}
}
