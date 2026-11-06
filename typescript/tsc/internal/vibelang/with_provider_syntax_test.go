package vibelang

import "testing"

func TestRetiredWithProviderHasNoTrailingBlockAdvice(t *testing.T) {
	for _, kind := range []string{"function", "effect function"} {
		for _, provider := range []string{"Layer.empty", "Live", "makeLive()", "[Live]", "[Live, Other]", "flag ? Live : Other", "Service = value", "Live ?? Other", "Live!", "Layers[key]"} {
			for _, space := range []string{" ", " /* provider */ ", "\t"} {
				source := "export " + kind + " probe() { with" + space + provider + " { return 1 } }"
				native := false
				for _, d := range trailingBlockErrorsOf(t, source) {
					if d.Code() == 1005 {
						native = true
					}
					if d.Source() == diagnosticSource && d.Code() == EK1101.Code {
						t.Fatalf("retired provider got callback migration advice: %s", d.String())
					}
				}
				if !native {
					t.Fatalf("retired with provider lost its native syntax error: %s", source)
				}
			}
		}
	}
}

func TestRetiredWithProviderKeepsNestedTrailingBlockAdvice(t *testing.T) {
	for _, source := range []string{
		"export effect function probe() { with Live { run { return 1 } } }",
		"export function probe() { with (run { return 1 }) {} }",
		"export effect function probe() { with flag ? Live : Other { run { return 1 } } }",
		"export effect function probe() { with Service = value { run { return 1 } } }",
		"export effect function probe() { with Live ?? Other { run { return 1 } } }",
		"export effect function probe() { with makeLive(run { return 1 }) {} }",
		"export effect function probe() { with flag ? Live : makeLive(run { return 1 }) {} }",
		"export function probe() { with (flag ? Live : run { return 1 }) {} }",
	} {
		count := 0
		for _, d := range trailingBlockErrorsOf(t, source) {
			if d.Source() == diagnosticSource && d.Code() == EK1101.Code {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("expected one real trailing-block diagnostic, got %d: %s", count, source)
		}
	}
}
