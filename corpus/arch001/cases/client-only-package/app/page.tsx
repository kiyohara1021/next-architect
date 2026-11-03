"use client";

import { theme } from "../lib/theme";

// No hooks, no handlers, no browser APIs — and the directive is still
// required, because the theme module reaches a client-only package.
// Reporting this would be the false positive from corpus/oss/REVIEW.md D1.
export default function Page() {
  return <div style={{ color: theme.color }}>themed</div>;
}
