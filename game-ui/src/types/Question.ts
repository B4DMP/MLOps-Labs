export type Question = {
  question: string;
  answers: { id: number; text: string }[];
  knowledge_question: boolean;
  notes: boolean;
  inputField: boolean;
  title?: string;
  description?: string;
};