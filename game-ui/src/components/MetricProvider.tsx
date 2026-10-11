import { createContext } from "react";

type MetricsContextType = {
  metrics: Record<
    string,
    {
      id: string;
      name: string;
      description: string;
      start_value: number;
      value?: number;
      phases: boolean[];
      metric_icon: string;
      max_value: number;
      metric_color: string;
    }
  >;
  setMetrics: React.Dispatch<React.SetStateAction<any>>;
  /** How each metric moved the last time the numbers changed. Never set by the introduction phase. */
  shifts?: Record<string, number>;
};

export const MetricsContext = createContext<MetricsContextType>({
  metrics: {},
  setMetrics: () => {},
});
