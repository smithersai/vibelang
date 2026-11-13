package vibelangfmt

import "testing"

func TestFormatServiceConstructorMethods(t *testing.T) {
	for _, member := range []string{"constructor():number", "constructor<T>(x:T):T", "\"constructor\"():number", "constructor()"} {
		t.Run(member, func(t *testing.T) {
			source := "service S {static readonly key=\"format/S\";" + member + "}\n"
			formatted, err := Format("main.vibe", source, func(text string) (string, error) { return text, nil })
			if err != nil {
				t.Fatal(err)
			}
			if formatted != source {
				t.Fatalf("method did not round trip:\n%s", formatted)
			}
		})
	}
}
