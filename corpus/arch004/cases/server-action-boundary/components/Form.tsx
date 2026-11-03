"use client";

import { useState } from "react";
import { submit } from "../app/actions";

export function Form() {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => submit().then(() => setDone(true))}>
      {done ? "sent" : "send"}
    </button>
  );
}
