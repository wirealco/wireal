import { Description, Label, Radio, RadioGroup } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { WorkspaceKind } from "./domain";
import { Code2, List } from "./icons";
import { WorkspaceKindArt } from "./workspace-kind-art";

const modes = [
  { value: "coding", icon: Code2 },
  { value: "everyday", icon: List },
] as const;

/** Choosing a workspace kind is the one decision made before there is anything
 *  to look at, so the cards variant shows each kind rather than naming it: a
 *  miniature of the canvas it would give you, awake while the card is hovered
 *  or chosen and quiet otherwise. The compact variant is the same radio group
 *  at toolbar size, where a glyph is the right amount of picture. */
export function WorkspaceKindPicker({
  value,
  onChange,
  variant = "cards",
}: {
  value: WorkspaceKind | null;
  onChange: (value: WorkspaceKind) => void;
  variant?: "cards" | "compact";
}) {
  const { t } = useTranslation();
  const isCompact = variant === "compact";

  return (
    <RadioGroup
      className={`workspace-kind workspace-kind--${variant}`}
      /* Null rather than "": react-aria gives the first radio a tab stop only
         while nothing is selected, and an empty string is a selection that
         matches no radio — which left the group unreachable by keyboard until
         a kind had been picked with the mouse. */
      value={value}
      aria-label={isCompact ? t("workspaceKind.heading") : undefined}
      onChange={(next) => {
        if (next === "coding" || next === "everyday") onChange(next);
      }}
    >
      {!isCompact && (
        <Label className="workspace-kind__heading">
          {t("workspaceKind.heading")}
        </Label>
      )}
      <div className="workspace-kind__options">
        {modes.map(({ value: mode, icon: Icon }) => (
          <Radio key={mode} value={mode} className="workspace-kind__option">
            {isCompact ? (
              <Radio.Content className="workspace-kind__segment">
                <Radio.Control className="workspace-kind__segment-control">
                  <Radio.Indicator />
                </Radio.Control>
                <span className="workspace-kind__segment-icon">
                  <Icon size={14} aria-hidden="true" />
                </span>
                <span>{t(`workspaceKind.${mode}`)}</span>
              </Radio.Content>
            ) : (
              <Radio.Content className="workspace-kind__card">
                <span className="workspace-kind__stage">
                  <WorkspaceKindArt kind={mode} height={88} />
                </span>
                <span className="workspace-kind__title">
                  <span>{t(`workspaceKind.${mode}`)}</span>
                  <Radio.Control className="workspace-kind__indicator">
                    <Radio.Indicator />
                  </Radio.Control>
                </span>
                <Description className="workspace-kind__description">
                  {t(`workspaceKind.${mode}Description`)}
                </Description>
              </Radio.Content>
            )}
          </Radio>
        ))}
      </div>
      {isCompact && value && (
        <Description className="workspace-kind__current-description">
          {t(`workspaceKind.${value}Description`)}
        </Description>
      )}
    </RadioGroup>
  );
}
