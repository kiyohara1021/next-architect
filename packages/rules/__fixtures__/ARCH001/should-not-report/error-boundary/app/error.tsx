"use client";

export default function ErrorBoundary({
  error,
}: {
  error: Error;
  reset: () => void;
}) {
  return <p>{error.message}</p>;
}
