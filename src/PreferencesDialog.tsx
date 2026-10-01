import { useTranslation } from "react-i18next";
import { Button, Modal, ScrollShadow, Switch } from "@heroui/react";
import { Dialog, SettingRow, SettingsCard } from "./ui";
import { ThemeToggle } from "./WorkspaceSidebar";
import type { BoardBackground } from "./board-background";
import type { CardDrift } from "./card-drift";
import type { ThemePreference } from "./theme";

export function PreferencesDialog({
  onClose,
  theme,
  onThemeChange,
  boardBackground,
  onBoardBackgroundChange,
  cardDrift,
  onCardDriftChange,
  onRestartTour,
}: {
  onClose: () => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  boardBackground: BoardBackground;
  onBoardBackgroundChange: (background: BoardBackground) => void;
  cardDrift: CardDrift;
  onCardDriftChange: (drift: CardDrift) => void;
  onRestartTour: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      title={t("preferences.title")}
      onClose={onClose}
      size="sm"
      dialogClassName="w-[calc(100vw-2rem)] max-w-[560px]"
    >
      <Modal.Body className="flex min-h-0 flex-col p-0">
        <ScrollShadow
          orientation="vertical"
          variant="fade"
          hideScrollBar
          className="flex max-h-[76dvh] min-w-0 flex-col gap-3 p-4"
        >
          <SettingsCard
            title={t("theme.appearance")}
            note={t("preferences.appearanceDescription")}
          >
            <SettingRow title={t("theme.colorTheme")}>
              <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
            </SettingRow>
          </SettingsCard>
          <SettingsCard
            title={t("preferences.whiteboardBackground")}
            note={t("preferences.whiteboardBackgroundDescription")}
          >
            <div className="flex flex-col gap-3">
              <Switch
                isSelected={boardBackground === "fluid"}
                onChange={(selected) =>
                  onBoardBackgroundChange(selected ? "fluid" : "dots")
                }
              >
                <Switch.Content className="flex items-center gap-2.5">
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  {t("preferences.fluidBackground")}
                </Switch.Content>
              </Switch>
              <Switch
                isSelected={cardDrift === "on"}
                onChange={(selected) =>
                  onCardDriftChange(selected ? "on" : "off")
                }
              >
                <Switch.Content className="flex items-center gap-2.5">
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  {t("preferences.cardDrift")}
                </Switch.Content>
              </Switch>
            </div>
          </SettingsCard>
          <SettingsCard
            title={t("preferences.gettingStarted")}
            note={t("preferences.gettingStartedDescription")}
          >
            <div className="flex">
              <Button
                variant="secondary"
                onPress={() => {
                  onClose();
                  onRestartTour();
                }}
              >
                {t("preferences.showTour")}
              </Button>
            </div>
          </SettingsCard>
        </ScrollShadow>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="primary" onPress={onClose}>
          {t("common.done")}
        </Button>
      </Modal.Footer>
    </Dialog>
  );
}
