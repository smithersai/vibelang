// The same text in a .ts file is a script: its top-level names are global,
// so the two .ts twins collide (TS2451, TS2393), and the .vibe files do not.
const shared = "a"
function helper() { return shared }
helper()
