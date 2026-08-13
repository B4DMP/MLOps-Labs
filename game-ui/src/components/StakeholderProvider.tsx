import { createContext } from "react";

type StakeholderContextType = {
  stakeholders: Record<
    string,
    {
      id: string;
      name: string;
      responsibilities: string;
      priorities: string;
      constraints: string;
      role_description: string;
      metric_id: string;
      stakeholder_color: string;
    }
  >;
  setStakeholders: React.Dispatch<React.SetStateAction<any>>;
};

export const StakeholderContext = createContext<StakeholderContextType>({
  stakeholders: {},
  setStakeholders: () => {},
});
