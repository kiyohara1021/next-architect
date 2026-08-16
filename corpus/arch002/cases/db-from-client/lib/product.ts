import { db } from "./database";

export function getProduct() {
  return db.query("select 1");
}
