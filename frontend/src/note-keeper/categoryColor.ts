import { CATEGORY_COLORS } from "./constants";

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other;
}
