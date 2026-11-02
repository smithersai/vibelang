import { Option, Schema } from "effect"
type Grid = ReadonlyArray<ReadonlyArray<number>>
type Model = Readonly<{ grid: Grid; undoStack: ReadonlyArray<Grid>; redoStack: ReadonlyArray<Grid> }>
type Flags = Readonly<{ maybeSavedCanvas: Option.Option<Readonly<{ grid: Grid }>> }>
type Result = Model
export const init = (flags: Flags): Result => ({undoStack: [],
redoStack: [],
grid: Option.match(flags.maybeSavedCanvas, { onNone: () => [[0]], onSome: ({ grid }) => grid })})
