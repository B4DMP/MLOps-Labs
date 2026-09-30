export type Question = {
  question: string;
  answers: { id: number; text: string; icon?: string }[];
  knowledge_question: boolean;
  notes: boolean;
  inputField: boolean;
  title?: string;
  description?: string;
  /** Explicit answer-layout hint. Omitted = vertical list (or auto-detected horizontal scale for
   * a 5-option, digit-prefixed Likert item, e.g. the SUS questions). */
  layout?: "icons" | "scale";
  /** The answer key, present only when the server has `ENABLE_DOSSIER_DEBUG` on (see
   * `game_handler._with_answer_key_debug`) - absent entirely otherwise, same as
   * `IntelArtifactViewer`'s `debug` field for the offline intel deck. */
  debug?: { correct_id: number; correct_text: string };
};