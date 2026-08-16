"use client";

import { getProduct } from "../lib/product";

export function ProductList() {
  // Improper: calling server data from client component module graph
  void getProduct;
  return <div>list</div>;
}
