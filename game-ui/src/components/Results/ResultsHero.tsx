import { Icon } from "@iconify/react";
import OnceIcon from "./OnceIcon";
import BADGE_RIBBON_ICON from "./icons/badge-ribbon.json";
import CONFETTI_ICON from "./icons/confetti.json";
import PERSON_PROTESTING_ICON from "./icons/person-protesting.json";
import WARNING_TRIANGLE_ICON from "./icons/warning-triangle.json";
import WRENCH_ICON from "./icons/wrench.json";
import TEST_TUBES_ICON from "./icons/test-tubes.json";
import ROAD_BARRIER_ICON from "./icons/road-barrier.json";
import HANDS_APPLAUSE_ICON from "./icons/hands-applause.json";
import AVATARS_CHATTING_ICON from "./icons/avatars-chatting.json";
import SCALE_RETRO_ICON from "./icons/scale-retro.json";
import { HEALTH_BUCKET_WORD, healthBucket } from "../../utils/systemHealth";
import {
  PILLAR_HINT,
  PILLAR_ICON,
  PILLAR_LABEL,
  SCOREBOARD_ICON,
  SCOREBOARD_LABEL,
  SCOREBOARD_ORDER,
  type Pillar,
  type ResultsPayload,
} from "./types";
import styles from "./ResultsHero.module.css";

const percent = (score: number) => Math.round(Math.max(0, Math.min(1, score)) * 100);

/** One animation and a short caption per epilogue beat id (`gameConfig/EndgameEpilogue.json`),
 * telling the same facts the removed prose beats did but as a glance rather than a sentence to
 * parse - playtesters read "a stage broke" faster from a wrench than from a paragraph about it. */
const BEAT_ICON: Record<string, object> = {
  stakeholder_hostile: PERSON_PROTESTING_ICON,
  grudge_fired: WARNING_TRIANGLE_ICON,
  stage_broken: WRENCH_ICON,
  intel_misread: WARNING_TRIANGLE_ICON,
  intel_sharp: TEST_TUBES_ICON,
  vetoed_often: ROAD_BARRIER_ICON,
  clean_run: HANDS_APPLAUSE_ICON,
  room_warm: AVATARS_CHATTING_ICON,
  default: SCALE_RETRO_ICON,
};

const BEAT_CAPTION: Record<string, string> = {
  stakeholder_hostile: "A relationship never recovered",
  grudge_fired: "A skipped concern came back",
  stage_broken: "A stage broke and stayed broken",
  intel_misread: "Needs were often misread",
  intel_sharp: "Needs were read correctly",
  vetoed_often: "Proposals were blocked repeatedly",
  clean_run: "Nothing was forced through",
  room_warm: "The room stayed strong",
  default: "A steady, ordinary run",
};

function PillarMeter({ pillar }: { pillar: Pillar }) {
  const value = percent(pillar.score);
  return (
    <div className={styles.pillar} title={PILLAR_HINT[pillar.id]}>
      <div className={styles.pillarHead}>
        <span className={styles.pillarLabel}>
          <Icon icon={PILLAR_ICON[pillar.id]} aria-hidden />
          {PILLAR_LABEL[pillar.id]}
        </span>
        <span className={styles.pillarValue}>{value}%</span>
      </div>
      {/* A single ratio against a limit is a meter, not a chart. */}
      <div
        className={styles.track}
        role="meter"
        aria-label={PILLAR_LABEL[pillar.id]}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className={styles.fill} style={{ width: `${value}%` }} />
      </div>
      {pillar.relative && <span className={styles.pillarNote}>gained on the system you inherited</span>}
    </div>
  );
}

export interface ResultsHeroProps {
  results: ResultsPayload;
  /** Shown as a ribbon when the account has used the playtest tools (D10). */
  playtest?: boolean;
}

/**
 * The screenshot target: one fixed-proportion card holding everything worth sharing - the grade,
 * what became of the company, the four pillars and the business scoreboard.
 *
 * Every size is a container-relative unit, so the card scales as one piece instead of reflowing.
 * That is what makes a screenshot of it look the same on a laptop and on a projector.
 *
 * The badge-ribbon is the same for every grade: this is a game-over screen that is meant not to be
 * negative, and a badge that visibly dims or shrinks for a low grade would turn a D into a public
 * failure. The letter and its label carry the grade; the ribbon is a constant, not a scale.
 *
 * The Lordicon animations here (docs/plans/results-screen.md, "Lordicon best practices") all play
 * once on arrival and settle on their final frame - never looped, since a card meant to be read
 * rather than glanced at is exactly the case Lordicon's own guidance warns against animating on
 * loop. Confetti is the one exception gated to top grades: a fixed badge already avoids making a
 * low grade look bleak, so a burst of celebration only needs to show up when it is warranted.
 */
export default function ResultsHero({ results, playtest = false }: ResultsHeroProps) {
  const { grade, epilogue, pillars, setting } = results;
  const overall = percent(grade.overall);
  const celebrate = grade.grade === "S" || grade.grade === "A";

  const gathered = results.intel.per_stakeholder.reduce((sum, row) => sum + row.gathered, 0);
  const available = results.intel.per_stakeholder.reduce((sum, row) => sum + row.available, 0);
  const vetoes = results.decisions.filter((d) => d.outcome === "VETO").length;
  const health = results.pipeline.system_health;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Challenges played", value: String(results.decisions.length) },
    { label: "Intel found", value: available ? `${gathered} of ${available}` : String(gathered) },
    { label: "Proposals vetoed", value: String(vetoes) },
    {
      label: "System",
      value: health == null ? "unclear" : HEALTH_BUCKET_WORD[healthBucket(health)],
    },
  ];

  return (
    <section className={styles.card} data-grade={grade.grade} aria-label="Run summary">
      {playtest && <div className={styles.ribbon}>Playtest account</div>}

      <header className={styles.topline}>
        <span className={styles.brand}>
          {setting.system} <span className={styles.brandDot}>·</span> {setting.company}
        </span>
        <span className={`${styles.runTag} ${playtest ? styles.runTagClear : ""}`}>
          {results.is_spiral ? `Iteration ${results.run_index}` : `Run ${results.run_index}`}
          {results.is_spiral && <span className={styles.spiralTag}>next iteration</span>}
        </span>
      </header>

      <div className={styles.main}>
        <div className={styles.gradeBlock}>
          <div className={styles.ribbonWrap}>
            <OnceIcon icon={BADGE_RIBBON_ICON} className={styles.ribbonIcon} />
            {celebrate && <OnceIcon icon={CONFETTI_ICON} className={styles.confettiIcon} />}
            <span className={styles.letter}>{grade.grade}</span>
          </div>
          <div className={styles.gradeLabel}>{grade.label}</div>
          <div className={styles.gradeSub}>{overall}% overall</div>
          <span className="visually-hidden">
            Grade {grade.grade}, {grade.label}, {overall} percent overall.
          </span>
        </div>

        <div className={styles.verdict}>
          <h2 className={styles.verdictTitle}>What became of {setting.company}</h2>
          <p className={styles.closing}>{epilogue.closing}</p>
          {epilogue.beats.length > 0 && (
            <ul className={styles.beatStrip}>
              {epilogue.beats.map((beat) => (
                <li key={beat.id} className={styles.beatItem}>
                  <OnceIcon
                    icon={BEAT_ICON[beat.id] ?? BEAT_ICON.default}
                    className={styles.beatIcon}
                  />
                  <span>{BEAT_CAPTION[beat.id] ?? beat.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={styles.pillars}>
        {pillars.map((pillar) => (
          <PillarMeter key={pillar.id} pillar={pillar} />
        ))}
      </div>

      <dl className={styles.scoreboard}>
        {SCOREBOARD_ORDER.map((key) => (
          <div key={key} className={styles.scoreItem}>
            <dt className={styles.scoreLabel}>
              <Icon icon={SCOREBOARD_ICON[key]} aria-hidden />
              {SCOREBOARD_LABEL[key]}
            </dt>
            <dd className={styles.scoreText}>{epilogue.scoreboard[key]}</dd>
          </div>
        ))}
      </dl>

      <footer className={styles.stats}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.stat}>
            <span className={styles.statValue}>{stat.value}</span>
            <span className={styles.statLabel}>{stat.label}</span>
          </div>
        ))}
      </footer>
    </section>
  );
}
