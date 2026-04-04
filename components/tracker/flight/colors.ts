export const SELECTED_FLIGHT_COLOR = '#38bdf8';

export function getFlightMapColor(index: number, isSelected: boolean) {
  if (isSelected) {
    return SELECTED_FLIGHT_COLOR;
  }

  const hue = (index * 57) % 360;
  return `hsl(${hue} 78% 64%)`;
}
