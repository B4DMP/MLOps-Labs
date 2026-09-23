import { createContext, useContext, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import styles from "./Accordion.module.css";

interface AccordionContextValue {
  openId: string | null;
  toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

interface AccordionProps {
  /** The section open on first render, if any - single-open, so opening another closes it. */
  defaultOpenId?: string | null;
  children: ReactNode;
}

export function Accordion({ defaultOpenId = null, children }: AccordionProps) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  return (
    <AccordionContext.Provider value={{ openId, toggle }}>
      <div className={styles.accordion}>{children}</div>
    </AccordionContext.Provider>
  );
}

interface AccordionSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

export function AccordionSection({ id, title, children }: AccordionSectionProps) {
  const context = useContext(AccordionContext);
  if (!context) {
    throw new Error("AccordionSection must be rendered inside an Accordion.");
  }
  const isOpen = context.openId === id;

  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.header}
        onClick={() => context.toggle(id)}
        aria-expanded={isOpen}
      >
        <span className={styles.headerTitle}>{title}</span>
        <Icon icon={isOpen ? "ph:caret-up-bold" : "ph:caret-down-bold"} />
      </button>
      {isOpen && <div className={styles.body}>{children}</div>}
    </section>
  );
}
