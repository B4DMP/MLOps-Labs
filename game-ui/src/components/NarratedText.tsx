import { useEffect, useMemo, useState } from "react";
import SpokenText from "./SpokenText";
import { useSpeech } from "./useSpeech";
import { splitSentences, stripForSpeech } from "../utils/speech";

export interface NarratedTextProps {
  /** The line that is shown here and highlighted sentence by sentence while it is read. */
  text: string;
  /** Spoken just before `text` but shown elsewhere (e.g. a banner built from JSX). */
  lead?: string;
  className?: string;
}

const endsSentence = (s: string) => /[.!?]$/.test(s);

/** Reads `lead` + `text` aloud in the narrator voice once on mount and highlights `text` as it is
 * spoken. Mount it when its dialog opens; unmounting cancels only its own line. */
export default function NarratedText({ text, lead = "", className }: NarratedTextProps) {
  const { speak } = useSpeech();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Terminated so the lead never merges into the first sentence of `text`.
  const spokenLead = useMemo(() => {
    const clean = stripForSpeech(lead);
    return clean && !endsSentence(clean) ? `${clean}.` : clean;
  }, [lead]);
  const leadCount = useMemo(
    () => splitSentences(spokenLead).filter((s) => s.trim()).length,
    [spokenLead],
  );

  useEffect(() => {
    const spoken = stripForSpeech(text);
    if (!spoken) return;
    const cancel = speak(spokenLead ? `${spokenLead} ${spoken}` : spoken, {
      slot: "narrator",
      onSentence: ({ index }) => setActiveIndex(index),
      onEnd: () => setActiveIndex(null),
    });
    return () => {
      cancel();
      setActiveIndex(null);
    };
  }, [text, spokenLead, speak]);

  return (
    <SpokenText
      text={text}
      className={className}
      activeSentenceIndex={activeIndex == null ? null : activeIndex - leadCount}
    />
  );
}
