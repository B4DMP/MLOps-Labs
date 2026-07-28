import { createContext } from "react";

type StakeholderContextType = {
  stakeholders: Record<
    string,
    {
      id: string;
      name: string;
      division: string;
      responsibilities: string;
      priorities: string;
      constraints: string;
      division_description: string;
      is_selected: boolean;
      metric_id: string;
      stakeholder_color: string;
      metric_expertise_values: Record<string, number>;
      active: boolean[];
    }
  >;
  setStakeholders: React.Dispatch<React.SetStateAction<any>>;
};

export const StakeholderContext = createContext<StakeholderContextType>({
  stakeholders: {},
  setStakeholders: () => {},
});
