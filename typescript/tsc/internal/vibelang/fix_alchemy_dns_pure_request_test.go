package vibelang

import (
	"strings"
	"testing"
)

func TestAlchemyDnsPureRequest(t *testing.T) {
	assertAlchemyDnsFix(t, `import * as HttpClientRequest from "effect/http/HttpClientRequest"
export const request = HttpClientRequest.get("https://dns.example").pipe(
  HttpClientRequest.setUrlParams({ name: "example.org", type: "TXT" }),
  HttpClientRequest.setHeader("Accept", "application/dns-json"),
)
`, ".pipe(", "setUrlParams(%,")
}

func TestAlchemyRequestPipeKeepsObservableArguments(t *testing.T) {
	source := `import * as HttpClientRequest from "effect/http/HttpClientRequest"
let calls = 0
const next = () => { calls++; return { name: String(calls) } }
export const request = HttpClientRequest.get("https://dns.example").pipe(
  HttpClientRequest.setUrlParams(next()),
  HttpClientRequest.setHeader("Accept", "application/dns-json"),
)
`
	got, result := fixedPipe(t, source)
	if !strings.Contains(got, ".pipe(") || !strings.Contains(got, "setUrlParams(next())") {
		t.Fatalf("interleaved pure transforms with argument construction:\n%s", got)
	}
	found := false
	for _, refused := range result.Refused {
		found = found || strings.Contains(refused.Error, "interleaved construction")
	}
	if !found {
		t.Fatalf("missing construction-order refusal: %+v", result.Refused)
	}
}
