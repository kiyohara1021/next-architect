"use client";

import { useState } from "react";

export function useClientThing() {
  return useState(0);
}
