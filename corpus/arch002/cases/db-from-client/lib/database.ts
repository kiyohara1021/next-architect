import pg from "pg";

export const db = {
  query: (sql: string) => ({ sql, client: pg }),
};
