export const live: number = 42

export class NotFound {
  readonly tag = "NotFound"
}

export const find: {
    /** @throws {never} */
    (id: string): string;
} = (id: string): string => id
