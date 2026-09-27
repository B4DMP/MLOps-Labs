const SOURCES: { href: string; label: string }[] = [
  { href: "https://link.springer.com/article/10.1186/s41039-021-00158-8", label: "The educational power of humor on student engagement — RPTEL, Springer" },
  { href: "https://arxiv.org/pdf/1903.03019", label: "Engaging Users with Educational Games: The Case of Phishing — arXiv" },
  { href: "https://elearningindustry.com/does-humor-keep-students-engaged", label: "Humor In Learning: Does It Keep Students Engaged? — eLearning Industry" },
  { href: "https://www.edutopia.org/blog/laughter-learning-humor-boosts-retention-sarah-henderson", label: "Laughter and Learning: Humor Boosts Retention — Edutopia" },
  { href: "https://www.uxdesigninstitute.com/blog/tone-of-voice-for-ux-writing/", label: "How to define your tone of voice in UX writing" },
  { href: "https://blog.logrocket.com/ux-design/tones-of-voice-ux-writing/", label: "Understanding tones of voice for better UX writing — LogRocket" },
  { href: "https://www.ems1.com/ems-humor/inside-gallows-humor-the-psychological-safety-net-behind-the-jokes-we-tell", label: "Inside gallows humor — EMS1" },
  { href: "https://en.wikipedia.org/wiki/The_Ministry_of_Silly_Walks", label: "The Ministry of Silly Walks — Wikipedia" },
  { href: "https://www.thegadflymagazine.org/home-1/wnppz71es2np0u0o6yv8y5l9c8t2u9", label: "Death by Complaint: bureaucracy through the Dead Parrot sketch — Gadfly" },
  { href: "https://en.wikipedia.org/wiki/Good_Omens_(TV_series)", label: "Good Omens — Wikipedia" },
  { href: "https://en.wikipedia.org/wiki/Vogon", label: "Vogon — Wikipedia" },
  { href: "https://en.wikipedia.org/wiki/The_Hitchhiker%27s_Guide_to_the_Galaxy_(novel)", label: "The Hitchhiker's Guide to the Galaxy — Wikipedia" },
  { href: "https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing", label: "Wikipedia:Signs of AI writing" },
];

export default function Sources() {
  return (
    <footer className="pt-4 border-top small text-secondary">
      Sources referenced
      <ol className="mt-2">
        {SOURCES.map((s) => (
          <li key={s.href}><a href={s.href}>{s.label}</a></li>
        ))}
      </ol>
    </footer>
  );
}
