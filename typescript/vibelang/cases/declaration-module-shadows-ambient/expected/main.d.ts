import { FileSystem, Path } from "effect";
export declare const fileSystem: {
    /** @throws {never} */
    (base: FileSystem.FileSystem, rooted: Path.Path): FileSystem.FileSystem;
};
