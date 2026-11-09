package vibelang

import ()

const provideServiceScopeSource = `service Key {
 static readonly key = "fix-scope/Key"
 value: number
}
effect function observe(): string!! {
 const memo = try Effect.serviceOption(Layer.CurrentMemoMap)
 return memo._tag
}
export effect function main() {
 return try Effect.provideService(observe(), Key, { value: 1 })
}
`
