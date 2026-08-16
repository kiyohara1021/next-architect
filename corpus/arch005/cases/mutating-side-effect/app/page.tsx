async function getUser() {
  return { id: 1 };
}
async function createSession() {
  return { ok: true };
}

export default async function Page() {
  const user = await getUser();
  const session = await createSession();
  return (
    <div>
      {user.id} / {session.ok ? "ok" : "fail"}
    </div>
  );
}
