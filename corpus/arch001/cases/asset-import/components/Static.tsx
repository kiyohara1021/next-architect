"use client";

// A stylesheet import in the layout must not silence this. Counting assets as
// unresolved imports used to disable ARCH001 for the whole app
// (corpus/oss/REVIEW.md, D3).
export function Static() {
  return <p>static</p>;
}
