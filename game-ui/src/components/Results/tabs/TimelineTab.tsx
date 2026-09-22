import EventLog from "../../EventLog";
import { Empty, Section } from "../parts";
import type { ResultsPayload } from "../types";

/** Everything that happened, with the reason it happened: the same log the player had in play,
 * kept whole. */
export default function TimelineTab({ results }: { results: ResultsPayload }) {
  if (results.events.length === 0) {
    return <Empty>Nothing was logged in this run.</Empty>;
  }
  return (
    <Section title="What happened, and why" note="Newest first, grouped by the step of the game it belongs to.">
      <EventLog events={results.events} showToggle={false} />
    </Section>
  );
}
