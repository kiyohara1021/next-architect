"use client";

import { forwardRef } from "react";

export const Box = forwardRef<HTMLDivElement, { children?: React.ReactNode }>(
  function Box({ children }, ref) {
    return <div ref={ref}>{children}</div>;
  },
);
