import { getUser } from "../lib/db";
import { Counter } from "../components/Counter";

export default function Page() {
  const user = getUser();
  return (
    <main>
      <p>{user.name}</p>
      <Counter />
    </main>
  );
}
