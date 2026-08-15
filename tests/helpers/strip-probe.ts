// T1.8 cross-file type-stripping probe.
//
// PROVENANCE, corrected 2026-08-14. An earlier version of this comment said
// "v4 is absent and treated as unrecoverable, so v2 governs". That was FALSE
// when written. v4 is present, pin re-derived
// sha256:9f99b1cca62dc2570c26a926239656cce707c3468d6ee009a8fe1383f1a10768.
//
// The correction does not change one line of code below, because BOTH specs
// ask for the same thing. v4 T1.8, line 301: "Confirm native type stripping,
// with the proof importing a second .ts file by explicit specifier. One
// passing test asserting a runtime value." v2 T1.8 asks the same. v4 is
// UNSEALED, so v2 still governs; v4 is recorded here as concurring, not as
// the authority.
//
// This file exists to be IMPORTED, so the stripping proof crosses a real file
// boundary rather than proving the easy self-contained half. It carries type
// syntax that must be erased at runtime: a generic interface, a generic
// function signature, and parameter and return annotations.
//
// Deliberately carries NO queue semantics. v2 section 5 fails Phase 1 if queue
// domain logic exists beyond the enumerated markers, and a helper that computed
// a place in line would be exactly that.
//
// erasableSyntaxOnly is set in tsconfig, so nothing here may be an enum, a
// namespace, or a parameter property. All three would survive erasure.

export interface Sample<T> {
  readonly label: string;
  readonly value: T;
}

export function addAll(values: readonly number[]): number {
  return values.reduce((total: number, next: number) => total + next, 0);
}

export function describeSample<T>(sample: Sample<T>): string {
  return `${sample.label}=${String(sample.value)}`;
}
