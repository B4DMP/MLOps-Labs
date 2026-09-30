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
};