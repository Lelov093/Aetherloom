import { useNavigate } from "react-router-dom";
import { ObjectBrowser } from "../objects/ObjectBrowser";
export function WorldSearch({
  world,
  onClose,
}: {
  world: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <ObjectBrowser
      world={world}
      title="搜索这个世界"
      browse
      searchFirst
      onClose={onClose}
      onPick={(object) => {
        onClose();
        navigate(object.to);
      }}
    />
  );
}
