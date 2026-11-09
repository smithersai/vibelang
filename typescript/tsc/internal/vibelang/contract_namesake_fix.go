package vibelang

import ()

// A contract that names an ambient type where its body needs Effect's.
//
// VIP-14 resolves a bare name per meaning: in a type position an ambient
// type keeps its name, so with the DOM lib loaded the FileSystem of
//
//	export effect function read(): Effect<string, never, FileSystem> {
//	  const fs = try FileSystem()
//	  …
//	}
//
// is the DOM's FileSystem interface, while FileSystem() reads Effect's
// FileSystem service. Before VIP-14 the bare type meant Effect's, so such a
// contract compiled; now the body's requirement escapes it (EK9202). The fix
// writes the contract's type through its module, FileSystem.FileSystem, the
// meaning the contract had, so --fix and --fix-vip-only migrate it. It is
// offered only where the contract's member and the body's requirement share
// the bare name and the module of that name exports the requirement's type
// (ambientNamesake); an EK9201 failure type gets the same fix.
