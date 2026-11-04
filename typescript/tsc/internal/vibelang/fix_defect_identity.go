package vibelang

// defectBridgeIdentity is an inline, provably nonthrowing mapper. An imported
// identity without a throws annotation may throw unknown under VIP-4 and cannot
// satisfy Effect.try's catch callback (proxy ruling, 2026-11-04).
const defectBridgeIdentity = "(e) => e"
