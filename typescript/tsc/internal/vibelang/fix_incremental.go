package vibelang

import ()

// The gate checked the whole program for each trial it could not refuse
// from some files, and on a 25-module batch of Smithers' apps/mvp worker
// (5,510 files, 2,392 of them checked) those checks were 70% of the run:
// from its third round on, each round checked the whole program once for
// a few fixes in one to eight files (2026-11-07). A fix changes the errors
// only of the files that read what it changed: TypeScript's incremental
// builder takes those to be the file and the files that import it
// (BuilderState.getFilesAffectedBy), and so does a --fix run. The gate keeps
// what its last check of a program found (a checkedProgram), and in a
// program that differs from it checks only
//
//   - the files whose text differs and every file that imports one, at any
//     depth; in a round, only the files that import one whose signature
//     changed, its declaration file or its exported statements but their
//     function bodies (fixRound; the builder also stops at an importer whose
//     own declaration is unchanged, which this does not);
//   - every file that reported an error in the last program, when a changed
//     file exports other names: an error names a type by a module that
//     exports it (symbolaccessibility.go);
//   - the .vibe files a changed file imports, which can bind their main
//     (wire.go's mainImported);
//   - the files that declare globals.
//
// A file the program adds is a changed file, and a file it drops was read
// only by changed files. Every other file reported no error in the last
// program and reads only files whose text is the same, so it reports none
// now. A check of the whole program stands in where that does not hold:
//
//   - a changed, added or dropped file declares globals, or a file that
//     imports a changed one does, since every file reads them;
//   - a changed file changes what VibeLang reads from every file of the
//     program: its service and control classes, their keys and default
//     values (services_check.go's sharingKey, service_reference_types.go);
//   - a .vibe file of the program does not resolve vibelang-runtime, and
//     missing_runtime.go reads every .vibe file;
//   - the program reports a global diagnostic, which any file's check can
//     add, or the run's first program did once checked;
//   - --only limits the errors the gate counts (fix_only.go).
//
// A check of the changed files that adds an error is made again of the
// whole program, in a program no check has read, so a refusal rests on the
// evidence it always rested on: a check of some files first can report an
// error a check of the whole program does not (gateRound.orderErrors).
//
// VIBELANG_FIX_CHECKS=whole checks the whole program every time;
// VIBELANG_FIX_CHECKS=verify checks it after each check of the changed
// files as well, keeps what the whole check found, and says on stderr where
// the two differ.

const ()
