
interface LoopPlaceholderProps {
  onContinue: () => void;
}

export default function AcSimulation({ onContinue }: LoopPlaceholderProps) {
  return (
    <div
      className="d-flex flex-column align-items-center justify-content-center text-center text-white p-5 min-vh-100"
      style={{
        background: "linear-gradient(135deg, #141e30, #243b55)",
        fontFamily: "'Inter', sans-serif"
      }}
    >
      <div
        className="card p-5 shadow-lg border-0"
        style={{
          background: "rgba(255, 255, 255, 0.08)",
          backdropFilter: "blur(12px)",
          borderRadius: "24px",
          maxWidth: "500px",
          width: "100%",
          boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
          border: "1px solid rgba(255, 255, 255, 0.1)"
        }}
      >
        <div
          className="mb-4 d-inline-flex align-items-center justify-content-center"
          style={{
            width: "80px",
            height: "80px",
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: "50%",
            fontSize: "2rem"
          }}
        >
          🚀
        </div>
        <h2 className="mb-2 fw-bold text-white" style={{ letterSpacing: "-0.5px" }}>
          Simulation
        </h2>
        <span
          className="badge mb-4 py-2 px-3 fs-6"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.15)",
            borderRadius: "12px",
            color: "#e2e8f0"
          }}
        >
          Loop Index: 3
        </span>
        <p className="mb-5 text-secondary-white" style={{ fontSize: "1.1rem", opacity: 0.85, lineHeight: "1.6" }}>
          Simulating the impact of the selected action card on the system. Review metrics progression and finalize the challenge outcomes.
        </p>
        <button
          onClick={onContinue}
          className="btn btn-primary btn-lg w-100 py-3 rounded-pill fw-bold shadow-lg"
          style={{
            background: "linear-gradient(45deg, #3b82f6, #8b5cf6)",
            border: "none",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: "0 4px 14px 0 rgba(139, 92, 246, 0.4)"
          }}
          onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
          onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
