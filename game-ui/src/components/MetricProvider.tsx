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
};

export const MetricsContext = createContext<MetricsContextType>({
  metrics: {},
  setMetrics: () => {},
});
