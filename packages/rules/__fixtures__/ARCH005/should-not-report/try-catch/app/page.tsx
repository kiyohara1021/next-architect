async function getUser() {
  return { id: 1 };
}
async function getProducts() {
  return [];
}

// D3: ordering inside try/catch/finally can be load-bearing (rollback,
// fallback on failure), so these awaits must not be offered for Promise.all.
export default async function Page() {
  try {
    const user = await getUser();
    const products = await getProducts();
    return (
      <div>
        {user.id} / {products.length}
      </div>
    );
  } catch {
    return <div>failed</div>;
  }
}
