// TypeScript 5.9.3 accepts these type members. VIP-15 gives a schema body
// its stricter field-only grammar; this twin controls ordinary TS behavior.
export interface Method { m(): string }
export interface Index { [k: string]: number }
export interface Call { (x: number): string }
export interface Construct { new (x: number): object }
export interface Getter { get n(): number }
export interface Setter { set n(value: number) }
export interface Nested { inner: { m(): void }; n: number }
export interface Fine { n: number; label?: string }
