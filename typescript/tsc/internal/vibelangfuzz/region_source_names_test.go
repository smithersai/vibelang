package vibelangfuzz

import "testing"

const regionCaptureSourceNamesQuote = "A value-only evaluation of an anonymous function or class cannot gain a name from a private variable or assignment; preserve a name the source explicitly requests."

func TestRegionSourceNamesQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", regionCaptureSourceNamesQuote)
}
