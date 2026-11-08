export const clock = { now: () => 12 } as Performance
export const randomness = {
  randomUUID: (): ReturnType<Crypto["randomUUID"]> => "00000000-0000-4000-8000-000000000000",
  getRandomValues: <T extends ArrayBufferView | null>(values: T): T => {
    if (values instanceof Uint8Array) values.fill(7)
    return values
  },
} as Crypto
