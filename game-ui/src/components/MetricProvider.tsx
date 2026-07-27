import { createContext } from "react";

type MetricsContextType = {
  metrics: {
    name: string;
    description: string;
    start_value: number;
    value?: number;
    phases: boolean[];
    metric_icon: string;
    max_value: number;
    metric_color: string;
  }[];
  setMetrics: React.Dispatch<React.SetStateAction<any>>;
};

export const MetricsContext = createContext<MetricsContextType>({
  metrics: [
    {
      name: "metric1",
      description: "desc",
      start_value: 1,
      phases: [true],
      metric_icon: "",
      max_value: 0,
      metric_color: "rgb(128,128,128)",
    },
  ],
  setMetrics: () => {},
});
