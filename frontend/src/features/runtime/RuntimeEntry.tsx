import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./api";

export function RuntimeEntry({ world }: { world: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    void window.aetherloomRuntime
      ?.available()
      .then((value) => {
        if (active) setAvailable(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return available ? (
    <Link className="text-link" to={`/worlds/${world}/simulate/runtime`}>
      打开 Text V2 世界线 →
    </Link>
  ) : null;
}
