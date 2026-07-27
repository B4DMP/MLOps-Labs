import React, { useMemo } from "react";
import type { Question } from "./types/Question";

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
  setAnswers
}: QuestionaireProps) {
  const shuffledQuestions = useMemo(() => {
    return questions.map((q) => ({
      ...q,
      answers: q.knowledge_question ? [...q.answers].sort(() => Math.random() - 0.5) : [...q.answers],
    }));
  }, [questions]);

  return (
    <div className="container mt-5" style={{
      overflowY: 'auto',
      maxHeight: '80vh',
      maxWidth: '50vw'
    }}>
      <div className="card shadow-sm p-4">
        <h3 className="mb-4">MLOps Questionnaire</h3>
        <div>
          {shuffledQuestions.map((question: Question, index: number) => (
            <React.Fragment key={index}>
              {question.title && <><br /><h4>{question.title}</h4></>}
              {question.description && <p>{question.description}</p>}
              <div className="list-group-item mb-3 border rounded">
                <p className="fw-bold mb-2">{question.question}</p>
                <div className="ms-3">
                  {question.answers.map((answer) => (
                    <div key={answer.id} className="form-check">
                      <input
                        className="form-check-input"
                        type="radio"
                        name={`question-${index}`}
                        id={`q${index}-a${answer.id}`}
                        style={{
                          backgroundColor: "var(--primary-bg)",
                          borderColor: "var(--secondary-bg)",
                        }}
                        value={answer.id}
                        checked={answers[index]?.id === answer.id}
                        onChange={() => {
                          const _answers = [...answers];
                          _answers[index] = { id: answer.id, notes: _answers[index]?.notes ?? "" };
                          setAnswers(_answers);
                        }}
                      />
                      <label
                        className="form-check-label"
                        htmlFor={`q${index}-a${answer.id}`}
                      >
                        {answer.text}
                      </label>
                    </div>
                  ))}
                  {(question.notes) && (
                    <input style={{ width: "80%", borderColor: "var(--secondary-bg)" }}
                      type="text"
                      className="form-control mt-2"
                      placeholder="input custom answer here"
                      value={answers[index]?.notes ?? ""}
                      onChange={(e) => {
                        const _answers = [...answers];
                        _answers[index] = { ..._answers[index], notes: e.target.value };
                        setAnswers(_answers);
                      }}
                    />
                  )}
                  {(question.inputField) && (
                    <textarea style={{ width: "80%", borderColor: "var(--secondary-bg)" }}
                      rows={5}
                      className="form-control mt-2"
                      placeholder="input custom answer here"
                      value={answers[index]?.notes ?? ""}
                      onChange={(e) => {
                        const _answers = [...answers];
                        _answers[index] = { ..._answers[index], notes: e.target.value };
                        setAnswers(_answers);
                      }}
                    />
                  )}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
        <button
          style={{
            backgroundColor: "var(--primary-bg)",
            borderColor: "var(--primary-bg)",
          }}
          className="btn btn-primary mt-4 w-100"
          onClick={onQuestionaireCompleted}
        >
          Submit Questionnaire
        </button>
      </div>
    </div>
  );
}
