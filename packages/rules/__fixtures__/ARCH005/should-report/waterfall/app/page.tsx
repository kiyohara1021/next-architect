async function getUser() {
  return { id: 1 };
}
async function getOrders(_userId: number) {
  return [];
}
async function getProducts() {
  return [];
}

export default async function Page() {
  const user = await getUser();
  const orders = await getOrders(user.id);
  const products = await getProducts();
  return (
    <div>
      {orders.length} / {products.length}
    </div>
  );
}
