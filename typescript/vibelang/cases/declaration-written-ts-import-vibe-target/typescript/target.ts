export type Factory = () => string

export const greeting: {
    /** @throws {never} */
    (): string;
} = (): string => 'hello'
