import { Section, Accordion } from "./shared";

const FINDINGS = [
  { title: "Springer RPTEL, 2021", body: "Humor works when it's content-relevant — comic relief alone doesn't teach anything." },
  { title: "arXiv 1903.03019", body: "Players explicitly want humor in serious games, not just tolerate it." },
  { title: "Edutopia / eLI", body: "Humor boosts engagement but can distract from the task — worth watching in playtests." },
  { title: "UX Design Institute / LogRocket", body: "Tone must stay consistent per surface, not sprinkled at random." },
  { title: "EMS1 / Lexipol", body: "Gallows humor works aimed at the situation — never at people." },
];

export default function Research() {
  return (
    <Section id="research" n="02" title="What the research says" defaultOpen={false}>
      <Accordion items={FINDINGS.map((f) => ({ title: f.title, body: <p className="mb-0">{f.body}</p> }))} />
    </Section>
  );
}
