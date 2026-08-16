import { createTheme } from "corpus-ui-kit";

// No "use client" here: this module is not a boundary, so whatever it pulls
// in lands in whoever imports it.
export const theme = createTheme();
