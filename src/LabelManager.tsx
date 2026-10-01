import { useState, type CSSProperties } from "react";
import { Button, Label, Modal } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "./icons";
import { deleteLabel, saveLabel, uid } from "./domain";
import { makeOrb } from "./orb-settings";
import { repository, useWorkspace } from "./store";
import { Choice, Dialog, Field, LabelBadge } from "./ui";

const defaultColor = "#669df6";

// Six columns of the palette, ordered around the wheel.
// prettier-ignore
const labelColors = [
  "#dc2626", "#f97316", "#f59e0b", "#facc15", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#78716c",
];

export function LabelManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [selection, setSelection] = useState(state.labels[0]?.id ?? "new");
  const [name, setName] = useState(state.labels[0]?.name ?? "");
  const [color, setColor] = useState(state.labels[0]?.color ?? defaultColor);
  const [error, setError] = useState("");
  const preview = name.trim() || t("labels.name");

  function select(id: string) {
    const label = state.labels.find((item) => item.id === id);
    setSelection(id);
    setName(label?.name ?? "");
    setColor(label?.color ?? defaultColor);
    setError("");
  }

  function save() {
    const existing = state.labels.find((label) => label.id === selection);
    try {
      repository.commit((current) =>
        saveLabel(current, {
          id: existing ? existing.id : uid(),
          name,
          color,
          orb: existing?.orb ?? makeOrb(color),
        }),
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("labels.invalid"));
    }
  }

  return (
    <Dialog title={t("navigation.labelSettings")} onClose={onClose}>
      <Modal.Body className="flex max-h-[70dvh] flex-col gap-4 overflow-auto">
        <div className="flex items-end gap-2">
          <Choice
            label={t("labels.label")}
            value={selection}
            onChange={select}
            options={[
              ...state.labels.map((label) => ({
                id: label.id,
                name: label.name,
              })),
              { id: "new", name: t("labels.new") },
            ]}
          />
          <Button
            isIconOnly
            variant="primary"
            aria-label={t("labels.new")}
            onPress={() => select("new")}
          >
            <Plus size={16} />
          </Button>
        </div>
        <Field
          label={t("labels.name")}
          value={name}
          onChange={setName}
          error={error}
          maxLength={30}
        />
        <div className="flex flex-col gap-2">
          <Label id="label-color">{t("labels.color")}</Label>
          <div
            role="radiogroup"
            aria-labelledby="label-color"
            className="grid grid-cols-6 justify-items-center gap-2"
          >
            {labelColors.map((swatch) => (
              // Selection is a ring drawn inside the 32px box — an outer ring
              // would bleed past the row edges and collide across the gap.
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-label={swatch}
                aria-checked={swatch.toLowerCase() === color.toLowerCase()}
                onClick={() => setColor(swatch)}
                style={{ "--swatch": swatch } as CSSProperties}
                className="group grid size-8 place-items-center rounded-full border-2 border-transparent transition-colors aria-checked:border-[var(--swatch)]"
              >
                <span className="size-full rounded-full bg-[var(--swatch)] transition-transform group-hover:scale-110 group-aria-checked:scale-[0.72]" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label id="label-preview">{t("labels.preview")}</Label>
          <div
            aria-labelledby="label-preview"
            className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            {/* The pill used on whiteboard cards and in the task list. */}
            <LabelBadge name={preview} color={color} />
            {/* The dot and name used wherever labels are assigned. */}
            <span className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              {preview}
            </span>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        {selection !== "new" && (
          <Button
            isIconOnly
            variant="danger-soft"
            aria-label={t("labels.delete")}
            onPress={() => {
              repository.commit((current) => deleteLabel(current, selection));
              select("new");
            }}
          >
            <Trash2 size={16} />
          </Button>
        )}
        <Button variant="tertiary" onPress={onClose}>
          {t("labels.cancel")}
        </Button>
        <Button variant="primary" onPress={save}>
          {t("labels.save")}
        </Button>
      </Modal.Footer>
    </Dialog>
  );
}
