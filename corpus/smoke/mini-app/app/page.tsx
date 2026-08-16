import { PlantedUnnecessary } from "../components/PlantedUnnecessary";
import { KnownGoodCounter } from "../components/KnownGoodCounter";

export default function Page() {
  return (
    <main>
      <PlantedUnnecessary label="smoke" />
      <KnownGoodCounter />
    </main>
  );
}
