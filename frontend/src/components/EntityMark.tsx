import {
  UserRound,
  MapPin,
  Flag,
  Package,
  Leaf,
  Lightbulb,
  ScrollText,
  Shapes,
} from "lucide-react";

const icons = {
  character: UserRound,
  location: MapPin,
  faction: Flag,
  item: Package,
  species: Leaf,
  concept: Lightbulb,
  world_rule: ScrollText,
  custom: Shapes,
};
export function EntityMark({
  kind,
  small = false,
}: {
  kind: string;
  small?: boolean;
}) {
  const Icon = icons[kind as keyof typeof icons] || Shapes;
  return (
    <span
      aria-hidden="true"
      className={`entity-mark entity-mark--${kind} ${small ? "entity-mark--small" : ""}`}
    >
      <Icon size={small ? 17 : 24} strokeWidth={1.6} />
    </span>
  );
}
