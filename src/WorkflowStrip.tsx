/** Workflows on the board: the strip of named pills along the top of the
 *  canvas, and the menu the selection bar opens to put tasks into one. A pill
 *  reads like a branch label on a commit graph — its colour is the glow its
 *  tasks wear on the board — and pressing it narrows the board to that
 *  workflow. An agent dragged from the agents panel onto a pill takes the
 *  whole workflow. */
import { useRef, useState, type CSSProperties } from "react";
import {
  Button,
  ColorSwatchPicker,
  Dropdown,
  Header,
  Input,
  Label,
  Popover,
  TextField,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { Workflow } from "./domain";
import { Plus, Trash2, X } from "./icons";
import { agentDragType, parseAgentDrag } from "./runners";
import { workflowPalette } from "./workflows";
import "./workflow-strip.css";

function NameForm({
  initial = "",
  submitLabel,
  onSubmit,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSubmit(name);
      }}
    >
      <TextField
        value={name}
        onChange={setName}
        autoFocus
        className="min-w-0 flex-1"
      >
        <Label>{t("workflows.namePlaceholder")}</Label>
        <Input
          maxLength={60}
          placeholder={t("workflows.namePlaceholder")}
          onKeyDown={(event) => {
            // Letters typed here are not board shortcuts; Escape still
            // closes the popover.
            if (event.key !== "Escape") event.stopPropagation();
          }}
        />
      </TextField>
      <Button type="submit" size="sm" isDisabled={!name.trim()}>
        {submitLabel}
      </Button>
    </form>
  );
}

function WorkflowPill({
  workflow,
  progress,
  active,
  droppable,
  onToggle,
  onRename,
  onRecolor,
  onDelete,
  onAgentDrop,
}: {
  workflow: Workflow;
  progress: { done: number; total: number };
  active: boolean;
  droppable: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  onAgentDrop: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="workflow-pill"
      data-active={active || undefined}
      data-agent-target={droppable ? `workflow:${workflow.id}` : undefined}
      data-over={over || undefined}
      style={{ "--workflow-color": workflow.color } as CSSProperties}
      onDragOver={(event) => {
        if (!droppable || !event.dataTransfer.types.includes(agentDragType))
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (!droppable) return;
        const drag = parseAgentDrag(event.dataTransfer.getData(agentDragType));
        if (!drag) return;
        event.preventDefault();
        onAgentDrop(drag.agent);
      }}
    >
      {/* The same key the commit map's legend draws for added and modified
      files: a small rounded swatch, then plain text. Pressing it filters the
      board, and the name takes the workflow's colour while it does. The menu
      is a right-click away so the strip stays a legend, not a toolbar. */}
      <button
        ref={trigger}
        type="button"
        className="workflow-pill__main"
        aria-pressed={active}
        title={`${t("workflows.progress", progress)} · ${t("workflows.menuHint")}`}
        aria-label={
          active
            ? t("workflows.showAll")
            : t("workflows.filterTo", { name: workflow.name })
        }
        onClick={onToggle}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <i className="workflow-pill__key" aria-hidden="true" />
        <span className="workflow-pill__name">{workflow.name}</span>
        <span className="workflow-pill__count">
          {progress.done}/{progress.total}
        </span>
      </button>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Popover.Content
          triggerRef={trigger}
          placement="bottom"
          offset={8}
          className="w-72"
        >
          <Popover.Dialog className="flex flex-col gap-4">
            <NameForm
              key={workflow.name}
              initial={workflow.name}
              submitLabel={t("workflows.save")}
              onSubmit={(name) => {
                onRename(name);
                setOpen(false);
              }}
            />
            <div className="flex flex-col gap-2">
              <Label>{t("workflows.color")}</Label>
              <ColorSwatchPicker
                size="sm"
                value={workflow.color}
                aria-label={t("workflows.color")}
                onChange={(color) => onRecolor(color.toString("hex"))}
              >
                {workflowPalette.map((color) => (
                  <ColorSwatchPicker.Item key={color} color={color}>
                    <ColorSwatchPicker.Swatch />
                    <ColorSwatchPicker.Indicator />
                  </ColorSwatchPicker.Item>
                ))}
              </ColorSwatchPicker>
            </div>
            <Button
              size="sm"
              variant="danger-soft"
              onPress={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={14} />
              {t("workflows.delete")}
            </Button>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}

export function WorkflowStrip({
  workflows,
  progress,
  active,
  droppable,
  onToggle,
  onRename,
  onRecolor,
  onDelete,
  onAgentDrop,
}: {
  workflows: Workflow[];
  progress: (workflowId: string) => { done: number; total: number };
  active: string | null;
  /** Whether an agent can be dropped on a workflow right now. */
  droppable: boolean;
  onToggle: (workflowId: string | null) => void;
  onRename: (workflowId: string, name: string) => void;
  onRecolor: (workflowId: string, color: string) => void;
  onDelete: (workflowId: string) => void;
  onAgentDrop: (workflowId: string, agentId: string) => void;
}) {
  const { t } = useTranslation();
  if (!workflows.length) return null;
  return (
    <nav className="workflow-strip" aria-label={t("workflows.strip")}>
      {active && (
        <button
          type="button"
          className="workflow-strip__all"
          onClick={() => onToggle(null)}
        >
          <X size={11} />
          {t("workflows.all")}
        </button>
      )}
      {workflows.map((workflow) => (
        <WorkflowPill
          key={workflow.id}
          workflow={workflow}
          progress={progress(workflow.id)}
          active={workflow.id === active}
          droppable={droppable}
          onToggle={() => onToggle(workflow.id === active ? null : workflow.id)}
          onRename={(name) => onRename(workflow.id, name)}
          onRecolor={(color) => onRecolor(workflow.id, color)}
          onDelete={() => onDelete(workflow.id)}
          onAgentDrop={(agentId) => onAgentDrop(workflow.id, agentId)}
        />
      ))}
    </nav>
  );
}

/** The selection bar's workflow button: start a workflow from the chosen
 *  tasks, add them to one that exists, or take them out of one. */
export function WorkflowSelectionMenu({
  workflows,
  selectedIn,
  onCreate,
  onAdd,
  onRemove,
}: {
  workflows: Workflow[];
  /** How many of the selected tasks each workflow already holds. */
  selectedIn: (workflowId: string) => number;
  onCreate: (name: string) => void;
  onAdd: (workflowId: string) => void;
  onRemove: (workflowId: string) => void;
}) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [naming, setNaming] = useState(false);
  const holding = workflows.filter((workflow) => selectedIn(workflow.id) > 0);
  const dot = (color: string) => (
    <span
      className="workflow-dot"
      style={{ "--workflow-color": color } as CSSProperties}
    />
  );
  return (
    <>
      <Dropdown>
        <Dropdown.Trigger ref={trigger}>
          {t("workflows.workflow")}
        </Dropdown.Trigger>
        <Dropdown.Popover placement="top" offset={12}>
          <Dropdown.Menu
            aria-label={t("workflows.workflow")}
            onAction={(key) => {
              const [action, id] = String(key).split(":");
              if (action === "new") setNaming(true);
              if (action === "add") onAdd(id);
              if (action === "remove") onRemove(id);
            }}
          >
            <Dropdown.Section aria-label={t("workflows.create")}>
              <Dropdown.Item
                id="new"
                textValue={t("workflows.newFromSelection")}
              >
                <Plus size={14} />
                {t("workflows.newFromSelection")}
              </Dropdown.Item>
            </Dropdown.Section>
            {workflows.length > 0 ? (
              <Dropdown.Section aria-label={t("workflows.addHeading")}>
                <Header>{t("workflows.addHeading")}</Header>
                {workflows.map((workflow) => (
                  <Dropdown.Item
                    key={workflow.id}
                    id={`add:${workflow.id}`}
                    textValue={workflow.name}
                  >
                    {dot(workflow.color)}
                    {workflow.name}
                  </Dropdown.Item>
                ))}
              </Dropdown.Section>
            ) : null}
            {holding.length > 0 ? (
              <Dropdown.Section aria-label={t("workflows.removeHeading")}>
                <Header>{t("workflows.removeHeading")}</Header>
                {holding.map((workflow) => (
                  <Dropdown.Item
                    key={workflow.id}
                    id={`remove:${workflow.id}`}
                    textValue={workflow.name}
                    variant="danger"
                  >
                    {dot(workflow.color)}
                    {workflow.name}
                  </Dropdown.Item>
                ))}
              </Dropdown.Section>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Popover isOpen={naming} onOpenChange={setNaming}>
        <Popover.Content
          triggerRef={trigger}
          placement="top"
          offset={12}
          className="w-72"
        >
          <Popover.Dialog>
            <NameForm
              submitLabel={t("workflows.create")}
              onSubmit={(name) => {
                onCreate(name);
                setNaming(false);
              }}
            />
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </>
  );
}
