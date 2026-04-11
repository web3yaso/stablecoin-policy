import type { Dispatch, SetStateAction } from "react";
import type { StanceType } from "@/types";

export const STANCE_HEX: Record<StanceType, string> = {
  restrictive: "#D98080",
  concerning: "#D9A766",
  review: "#D9C980",
  none: "#C9CBD1",
  favorable: "#7EBC8E",
};

export const NEUTRAL_FILL = "#EFEDE8";
export const NEUTRAL_STROKE = "#E5E5E5";
export const INK = "#1D1D1F";

export interface TooltipState {
  x: number;
  y: number;
  label: string;
}

export type SetTooltip = Dispatch<SetStateAction<TooltipState | null>>;
