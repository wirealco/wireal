import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Header,
  Kbd,
  ListBox,
  Modal,
  ScrollShadow,
  SearchField,
  Typography,
} from "@heroui/react";
import { Search } from "./icons";
import { TaskId } from "./ui";
import type { Project, Task, Workspace } from "./domain";

export function GlobalSearch({
  state,
  projects,
  onClose,
  onTask,
}: {
  state: Workspace;
  projects: Project[];
  onClose: () => void;
  onTask: (task: Task) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const needle = query.trim().toLowerCase();
  const tasks = useMemo(() => {
    const matches = state.tasks.filter((task) => {
      if (!needle) return true;
      const haystack = [
        task.name,
        task.referenceId,
        task.objective,
        ...task.labels,
        ...task.projectIds.map((id) => projectNames.get(id) ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
    return needle ? matches : matches.slice(0, 8);
  }, [needle, projectNames, state.tasks]);

  function choose(task: Task) {
    onClose();
    onTask(task);
  }

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur" className="global-search__backdrop">
        <Modal.Container
          placement="top"
          size="lg"
          className="global-search__container"
        >
          <Modal.Dialog
            aria-label={t("search.dialog")}
            className="global-search__dialog"
          >
            <Modal.Body className="overflow-hidden p-0">
              <SearchField
                value={query}
                onChange={setQuery}
                aria-label={t("search.all")}
                autoFocus
                className="global-search__field-wrap"
              >
                <SearchField.Group className="global-search__field">
                  <SearchField.SearchIcon>
                    <Search size={18} />
                  </SearchField.SearchIcon>
                  <SearchField.Input
                    aria-label={t("search.all")}
                    placeholder={t("search.placeholder")}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        document
                          .querySelector<HTMLElement>(
                            '.global-search__results [role="option"]',
                          )
                          ?.focus();
                      }
                    }}
                  />
                  <Kbd variant="light" className="mr-2">
                    <Kbd.Abbr keyValue="escape" />
                  </Kbd>
                </SearchField.Group>
              </SearchField>
              <ScrollShadow
                orientation="vertical"
                variant="fade"
                hideScrollBar
                size={28}
                className="global-search__results"
              >
                <ListBox
                  aria-label={t("search.results")}
                  selectionMode="single"
                  onAction={(key) => {
                    const found = tasks.find(
                      (task) => `task:${task.id}` === String(key),
                    );
                    if (found) choose(found);
                  }}
                >
                  {tasks.length > 0 && (
                    <ListBox.Section>
                      <Header>{t("search.tasks")}</Header>
                      {tasks.map((task) => (
                        <ListBox.Item
                          id={`task:${task.id}`}
                          key={`task:${task.id}`}
                          textValue={`${task.name} ${task.referenceId}`}
                        >
                          <Search size={14} className="text-muted" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{task.name}</span>
                            <span className="block truncate text-[11px] text-muted">
                              <TaskId value={task.referenceId} /> ·{" "}
                              {task.projectIds
                                .map((id) => projectNames.get(id))
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          </span>
                        </ListBox.Item>
                      ))}
                    </ListBox.Section>
                  )}
                </ListBox>
                {!tasks.length && (
                  <Typography
                    type="body-sm"
                    color="muted"
                    className="p-5 text-center"
                  >
                    {needle ? t("search.noTasksMatch") : t("search.noTasks")}
                  </Typography>
                )}
              </ScrollShadow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
