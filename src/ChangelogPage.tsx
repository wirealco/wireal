import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DocumentHero, PublicDocument } from "./PublicPage";
import { changelogDays } from "./changelog-entries";
import { currentLanguage } from "./i18n";
import type { ResolvedTheme, ThemePreference } from "./theme";
import "./changelog-page.css";

function useDateLabel() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(currentLanguage(), {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return (date: string) => format.format(new Date(`${date}T00:00:00Z`));
  }, [i18n.resolvedLanguage]);
}

export function ChangelogPage({
  theme,
  onThemeChange,
}: {
  theme: ResolvedTheme;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const { t } = useTranslation();
  const days = useMemo(() => changelogDays(), []);
  const dateLabel = useDateLabel();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  return (
    <PublicDocument theme={theme} onThemeChange={onThemeChange}>
      <DocumentHero title={t("changelog.title")} lead={t("changelog.lead")} />
      <div className="landing-section changelog" data-tone="raise">
        <div className="changelog__body">
          {days.map((day) => (
            <section className="changelog__day" key={day.date}>
              <h2 className="changelog__date">
                <time dateTime={day.date}>{dateLabel(day.date)}</time>
              </h2>
              <div className="changelog__entries">
                {day.entries.map((entry) => (
                  <article className="changelog__entry" key={entry.id}>
                    <h3 className="changelog__entry-title">{entry.title}</h3>
                    <p className="changelog__entry-text">{entry.text}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </PublicDocument>
  );
}
