async function getUser() {
  return { id: 1 };
}
async function getOrders(_userId: number) {
  return [];
}

export default async function Page() {
  const user = await getUser();
  const orders = await getOrders(user.id);
  return <div>{orders.length}</div>;
}
