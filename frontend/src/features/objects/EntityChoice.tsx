import { useEffect, useState } from "react";
import { Button, ErrorNotice } from "../../components/ui";
import { creationApi } from "../creation/api";
import { ObjectBrowser } from "./ObjectBrowser";

export function EntityChoice({
  world,
  label,
  value,
  onChange,
  kind,
  disabled = false,
  optional = false,
}: {
  world: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
  kind?: string;
  disabled?: boolean;
  optional?: boolean;
}) {
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setName("");
    setError("");
    if (value)
      creationApi
        .entity(value)
        .then((entity) => {
          if (active) {
            if (entity.world_id !== world) setError("引用不属于当前世界。");
            else setName(entity.name);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [world, value]);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="object-choice">
        <Button
          type="button"
          disabled={disabled}
          aria-label={`选择${label}`}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {name ||
            (!value ? (optional ? "未指定" : "选择对象…") : "正在读取对象…")}
        </Button>
        {optional && value && !disabled && (
          <Button
            type="button"
            variant="ghost"
            aria-label={`清除${label}`}
            onClick={() => onChange("")}
          >
            清除
          </Button>
        )}
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {open && (
        <ObjectBrowser
          world={world}
          title={`选择${label}`}
          types={["entity"]}
          entityKind={kind}
          onClose={() => setOpen(false)}
          onPick={(item) => {
            onChange(item.id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
