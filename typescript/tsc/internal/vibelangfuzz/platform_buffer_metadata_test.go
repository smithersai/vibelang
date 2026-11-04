package vibelangfuzz

import "testing"

func TestPlatformBufferFixtureRuntimeMetadata(t *testing.T) {
	foundFail, foundFixed := false, false
	for _, seed := range CaseSeeds() {
		switch seed.Name {
		case "platform-buffer-bytelength.fail":
			foundFail = true
			if len(seed.Codes) == 0 {
				t.Fatal("negative fixture lost its diagnostics")
			}
			if seed.ExpectResult != "" {
				t.Fatal("negative fixture became a runnable fuzz host")
			}
		case "platform-buffer-bytelength-fixed":
			foundFixed = true
			if seed.ExpectResult != "[2,4,0,2,1,3]" {
				t.Fatal("passing fixture lost its Unicode runtime oracle")
			}
		}
	}
	if !foundFail || !foundFixed {
		t.Fatal("missing Buffer quick-fix fixture pair")
	}
}
