const STAKEHOLDER_TOKENS = [
  "requirements_reuben",
  "reliability_ruth",
  "efficiency_emilia",
  "model_monica",
  "data_dave",
  "automation_alex",
];

const PATTERN = new RegExp(`\\b(${STAKEHOLDER_TOKENS.join("|")})\\b`, "g");

/** Wraps snake_case stakeholder tokens in a colored span so they're easy to spot in a wall of prose. */
export function highlightStakeholders(text: string) {
  return text.split(PATTERN).map((part, i) =>
    STAKEHOLDER_TOKENS.includes(part) ? (
      <span key={i} className="fw-semibold text-danger-emphasis">[{part}]</span>
    ) : (
      part
    ),
  );
}
