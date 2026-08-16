async function getUser() {
  return { id: 1 };
}
async function getProducts() {
  return [];
}

export default async function Page() {
  const [user, products] = await Promise.all([getUser(), getProducts()]);
  return (
    <div>
      {user.id} / {products.length}
    </div>
  );
}
