import React, { useMemo } from "react";
import type { Question } from "./types/Question";
import { Icon } from "@iconify/react";
import styles from "./Questionaire.module.css";

interface QuestionaireProps {
  onQuestionaireCompleted: () => void;
  questions: Question[];
  answers: (Record<string, any> | null)[];
  setAnswers: (answers: (Record<string, any> | null)[]) => void;
}

export default function Questionaire({
  onQuestionaireCompleted,
  questions,
  answers,
  setAnswers,
}: QuestionaireProps) {
  const shuffledQuestions = useMemo(() => {
    return questions.map((q) => ({
      ...q,
      answers: q.knowledge_question ? [...q.answers].sort(() => Math.random() - 0.5) : [...q.answers],
    }));
  }, [questions]);

  const answeredCount = answers.filter(
    (a) => a !== null && a !== undefined && (a.id !== undefined || (a.notes && a.notes.trim().length > 0))
  ).length;

  if (questions.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={`card shadow-lg border-0 rounded-4 overflow-hidden ${styles.panel} ${styles.loadingPanel}`}>
          <div className={styles.header}>
            <h2 className={styles.headerTitle}>
              <Icon icon="ph:clipboard-text-bold" style={{ color: "var(--secondary-bg)", fontSize: "1.8rem" }} />
              <span>MLOps Questionnaire</span>
            </h2>
          </div>
          <div className="p-5 text-center bg-white">
            <div
              className="spinner-border mx-auto mb-3"
              style={{ color: "var(--primary-bg)", width: "3rem", height: "3rem" }}
              role="status"
            >
              <span className="visually-hidden">Loading...</span>
            </div>
            <h5 className="mb-2 fw-bold text-dark">Retrieving Questions...</h5>
            <p className="text-secondary mb-0 small">Please wait while the questionnaire is loaded.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={`card shadow-lg border-0 rounded-4 overflow-hidden ${styles.panel}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            <Icon icon="ph:clipboard-text-bold" style={{ color: "var(--secondary-bg)", fontSize: "1.8rem" }} />
            <span>MLOps Questionnaire</span>
          </h2>
          <span className={styles.headerBadge}>
            {answeredCount} / {questions.length} Answered
          </span>
        </div>

        {/* Body */}
        <div className={styles.body}>


          {/* Questions */}
          <div>
            {shuffledQuestions.map((question: Question, index: number) => (
              <React.Fragment key={index}>
                {question.title && (
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>{question.title}</h3>
                    {question.description && (
                      <p className={styles.sectionDescription}>{question.description}</p>
                    )}
                  </div>
                )}

                <div className={styles.questionCard}>
                  <div className={styles.questionPromptRow}>
                    <span className={styles.questionNumberPill}>Q{index + 1}</span>
                    <p className={styles.questionText}>{question.question}</p>
                  </div>

                  {question.answers && question.answers.length > 0 && (
                    <div className={styles.optionsList}>
                      {question.answers.map((answer) => {
                        const isSelected = answers[index]?.id === answer.id;
                        return (
                          <label
                            key={answer.id}
                            className={`${styles.optionItem} ${isSelected ? styles.optionItemSelected : ""}`}
                            htmlFor={`q${index}-a${answer.id}`}
                          >
                            <input
                              className={styles.optionRadio}
                              type="radio"
                              name={`question-${index}`}
                              id={`q${index}-a${answer.id}`}
                              value={answer.id}
                              checked={isSelected}
                              onChange={() => {
                                const _answers = [...answers];
                                _answers[index] = { id: answer.id, notes: _answers[index]?.notes ?? "" };
                                setAnswers(_answers);
                              }}
                            />
                            <span className={styles.optionText}>{answer.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {question.notes && (
                    <div className={styles.notesWrapper}>
                      <label className={styles.notesLabel} htmlFor={`q${index}-notes`}>
                        <Icon icon="ph:note-pencil-bold" />
                        <span>Additional notes / custom answer:</span>
                      </label>
                      <input
                        id={`q${index}-notes`}
                        type="text"
                        className={styles.notesControl}
                        placeholder="Enter your notes or custom explanation here..."
                        value={answers[index]?.notes ?? ""}
                        onChange={(e) => {
                          const _answers = [...answers];
                          _answers[index] = { ..._answers[index], notes: e.target.value };
                          setAnswers(_answers);
                        }}
                      />
                    </div>
                  )}

                  {question.inputField && (
                    <div className={styles.notesWrapper}>
                      <label className={styles.notesLabel} htmlFor={`q${index}-inputField`}>
                        <Icon icon="ph:chat-teardrop-text-bold" />
                        <span>Detailed explanation:</span>
                      </label>
                      <textarea
                        id={`q${index}-inputField`}
                        rows={4}
                        className={styles.notesControl}
                        placeholder="Type your detailed explanation or answer here..."
                        value={answers[index]?.notes ?? ""}
                        onChange={(e) => {
                          const _answers = [...answers];
                          _answers[index] = { ..._answers[index], notes: e.target.value };
                          setAnswers(_answers);
                        }}
                      />
                    </div>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Action Area */}
          <div className={styles.actionArea}>
            <button
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              onClick={onQuestionaireCompleted}
            >
              <span>Submit Questionnaire</span>
              <Icon icon="ph:check-circle-bold" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
