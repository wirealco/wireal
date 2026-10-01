import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Chip,
  Checkbox,
  ColorSwatch,
  Description,
  FieldError,
  Dropdown,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextField,
  TextArea,
  Tooltip,
  Typography,
} from "@heroui/react";
import { X } from "./icons";
import {
  statuses,
  taskIdLabel,
  type Status,
  type LabelDefinition,
  type Project,
} from "./domain";
import { FluidOrb } from "./FluidOrb";
import { useWorkspace } from "./store";
import { StatusBadge } from "./StatusBadge";
import i18n from "./i18n";
import "./settings-card.css";

export const statusOptions = Object.keys(statuses).map((id) => ({
  id,
  get name() {
    return i18n.t(`status.${id}`);
  },
}));
export function IconButton({
  label,
  children,
  onPress,
  href,
  disabled = false,
  variant = "tertiary",
  className,
  pressed,
  tour,
}: {
  label: string;
  children: ReactNode;
  onPress?: () => void;
  /** Renders an anchor instead of a button, keeping the button's styling. */
  href?: string;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
  pressed?: boolean;
  /** Anchors a first-run tour step to this button. */
  tour?: string;
}) {
  return (
    <Tooltip delay={350}>
      <Tooltip.Trigger className="inline-flex">
        <Button
          isIconOnly
          size="sm"
          variant={variant}
          className={className}
          aria-label={label}
          aria-pressed={pressed}
          data-tour={tour}
          onPress={onPress}
          isDisabled={disabled}
          // render types its props for a <button>; the anchor takes the same DOM props.
          render={
            href
              ? (props) => (
                  <a
                    {...(props as unknown as ComponentProps<"a">)}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                  />
                )
              : undefined
          }
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
export function Section({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${className ?? ""}`}>
      {(title || description) && (
        <div className="min-w-0">
          {!!title && (
            <Typography type="body-sm" className="font-medium">
              {title}
            </Typography>
          )}
          {!!description && (
            <Typography type="body-xs" color="muted" className="text-pretty">
              {description}
            </Typography>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
export function TaskId({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <span className={`task-id ${className ?? ""}`}>{taskIdLabel(value)}</span>
  );
}
export function StatusChip({
  status,
  size = "sm",
}: {
  status: Status;
  size?: "sm" | "md";
}) {
  const state = useWorkspace();
  return (
    <StatusBadge
      status={status}
      color={state.statusOrbs[status].colors[0]}
      size={size}
    />
  );
}
export function SettingsCard({
  title,
  note,
  end,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  note?: string;
  end?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`settings-card ${className ?? ""}`}>
      {(!!title || !!end) && (
        <Card.Header className="flex-row items-start gap-3">
          <div className="min-w-0 flex-1">
            {!!title && <Card.Title className="truncate">{title}</Card.Title>}
            {!!note && (
              <Card.Description className="text-pretty">
                {note}
              </Card.Description>
            )}
          </div>
          {end}
        </Card.Header>
      )}
      <Card.Content>{children}</Card.Content>
      {!!footer && (
        <Card.Footer className="flex-wrap justify-end gap-3">
          {footer}
        </Card.Footer>
      )}
    </Card>
  );
}
export function SettingRow({
  title,
  hint,
  stacked,
  children,
}: {
  title: string;
  hint?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="settings-row" data-stacked={stacked || undefined}>
      <Typography type="body-sm" className="settings-row__title font-medium">
        {title}
      </Typography>
      <div className="settings-row__control">{children}</div>
      {!!hint && (
        <Typography
          type="body-xs"
          color="muted"
          className="settings-row__hint text-pretty"
        >
          {hint}
        </Typography>
      )}
    </div>
  );
}
export function Choice({
  label,
  value,
  options,
  renderOption,
  onChange,
  disabled = false,
  showLabel = true,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  renderOption?: (option: { id: string; name: string }) => ReactNode;
  onChange: (value: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => key !== null && onChange(String(key))}
      isDisabled={disabled}
    >
      {showLabel && <Label>{label}</Label>}
      <Select.Trigger>
        {renderOption ? (
          <Select.Value>
            {({ defaultChildren, state }) => {
              const selected = options.find(
                (option) => option.id === String(state.selectedItems[0]?.key),
              );
              return selected ? renderOption(selected) : defaultChildren;
            }}
          </Select.Value>
        ) : (
          <Select.Value />
        )}
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              id={option.id}
              key={option.id}
              textValue={option.name}
            >
              {renderOption ? renderOption(option) : option.name}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus = false,
  onBlur,
  maxLength = 160,
  description,
  error,
  required = false,
  disabled = false,
  showLabel = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  maxLength?: number;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <TextField
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      isRequired={required}
      isInvalid={!!error}
      isDisabled={disabled}
      validationBehavior="aria"
    >
      {showLabel && <Label>{label}</Label>}
      <Input
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
      />
      {description && <Description>{description}</Description>}
      <FieldError>{error}</FieldError>
    </TextField>
  );
}
export function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 2000,
  rows = 4,
  showLabel = true,
  autoSize = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  showLabel?: boolean;
  autoSize?: boolean;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!autoSize || !textareaRef.current) return;
    const textarea = textareaRef.current;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();

    let width = textarea.offsetWidth;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [autoSize, value]);

  return (
    <TextField value={value} onChange={onChange} isDisabled={disabled}>
      {showLabel && <Label>{label}</Label>}
      <TextArea
        ref={textareaRef}
        aria-label={label}
        className={autoSize ? "resize-none overflow-hidden" : undefined}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
      />
    </TextField>
  );
}

export function ProjectBadge({ project }: { project: Project }) {
  const { t } = useTranslation();
  return (
    <Chip size="sm" variant="secondary">
      <FluidOrb
        settings={project.orb}
        size={14}
        label={t("navigation.color", { name: project.name })}
      />
      <Chip.Label>{project.name}</Chip.Label>
    </Chip>
  );
}

export function ProjectOrbGroup({
  projects,
  onProjectPress,
}: {
  projects: Project[];
  onProjectPress: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="project-orb-picker" data-mode="action">
      {projects.map((project) => (
        <Tooltip key={project.id} delay={250}>
          <Tooltip.Trigger className="project-orb-picker__trigger">
            <button
              type="button"
              className="project-orb-picker__item"
              aria-label={t("mapEditor.editProject", { name: project.name })}
              onClick={() => onProjectPress(project.id)}
            >
              <span className="project-orb-picker__orb">
                <FluidOrb
                  settings={project.orb}
                  size={40}
                  label={t("navigation.color", { name: project.name })}
                />
              </span>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="top">{project.name}</Tooltip.Content>
        </Tooltip>
      ))}
    </div>
  );
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  presentation = "checkboxes",
}: {
  projects: Project[];
  value: string[];
  onChange: (ids: string[]) => void;
  presentation?: "checkboxes" | "orbs";
}) {
  const { t } = useTranslation();
  if (presentation === "orbs") {
    return (
      <fieldset className="flex flex-col gap-2">
        <Label>{t("editor.projects")}</Label>
        <div className="project-orb-picker">
          {projects.map((project) => {
            const selected = value.includes(project.id);
            const onlySelected = selected && value.length === 1;
            return (
              <Tooltip key={project.id} delay={250}>
                <Tooltip.Trigger className="project-orb-picker__trigger">
                  <button
                    type="button"
                    className="project-orb-picker__item"
                    data-selected={selected}
                    aria-label={t(
                      selected ? "editor.removeProject" : "editor.addProject",
                      { name: project.name },
                    )}
                    aria-pressed={selected}
                    disabled={onlySelected}
                    onClick={() =>
                      onChange(
                        selected
                          ? value.filter((id) => id !== project.id)
                          : [...value, project.id],
                      )
                    }
                  >
                    <span className="project-orb-picker__orb">
                      <FluidOrb
                        settings={project.orb}
                        size={40}
                        label={t("editor.addProject", { name: project.name })}
                      />
                    </span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content placement="top">
                  {project.name}
                </Tooltip.Content>
              </Tooltip>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <Label>{t("editor.projects")}</Label>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {projects.map((project) => (
          <Checkbox
            key={project.id}
            aria-label={project.name}
            isSelected={value.includes(project.id)}
            isDisabled={value.length === 1 && value.includes(project.id)}
            onChange={(checked) =>
              onChange(
                checked
                  ? [...value, project.id]
                  : value.filter((id) => id !== project.id),
              )
            }
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <FluidOrb
                settings={project.orb}
                size={14}
                label={t("navigation.color", { name: project.name })}
              />
              <Label>{project.name}</Label>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
    </fieldset>
  );
}
export function LabelPicker({
  labels,
  value,
  onChange,
}: {
  labels: LabelDefinition[];
  value: string[];
  onChange: (names: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <Label>{t("editor.labels")}</Label>
      {labels.length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {labels.map((label) => (
            <Checkbox
              key={label.id}
              aria-label={label.name}
              isSelected={value.includes(label.name)}
              onChange={(checked) =>
                onChange(
                  checked
                    ? [...value, label.name]
                    : value.filter((name) => name !== label.name),
                )
              }
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <ColorSwatch
                  color={label.color ?? "#a1a1aa"}
                  size="xs"
                  shape="circle"
                  aria-label={t("navigation.color", { name: label.name })}
                  style={{ width: 8, height: 8 }}
                />
                <Label>{label.name}</Label>
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
      ) : (
        <Description>{t("editor.noLabels")}</Description>
      )}
    </fieldset>
  );
}
export function LabelBadge({
  name,
  color,
  onRemove,
}: {
  name: string;
  /** Overrides the saved colour — used to preview an unsaved edit. */
  color?: string;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const swatch =
    color ??
    state.labels.find((label) => label.name === name)?.color ??
    "#a1a1aa";
  return (
    <span
      className="label-badge"
      style={{ "--label-color": swatch } as CSSProperties}
      title={name}
    >
      <span className="label-badge__dot" aria-hidden="true" />
      <span className="label-badge__text">{name}</span>
      {onRemove && (
        <button
          type="button"
          className="label-badge__remove"
          aria-label={t("editor.removeLabel", { name })}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X size={11} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
export function StatusMenu({
  label,
  status,
  onChange,
  disabled = false,
}: {
  label: string;
  status: Status;
  onChange: (status: Status) => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown>
      <Button
        size="md"
        variant="tertiary"
        className="status-menu-trigger bg-transparent hover:bg-transparent [&[data-hovered=true]]:bg-transparent"
        aria-label={label}
        isDisabled={disabled}
      >
        <StatusChip status={status} size="md" />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          aria-label={label}
          selectionMode="single"
          selectedKeys={new Set([status])}
          onAction={(key) => onChange(String(key) as Status)}
        >
          {statusOptions.map((option) => (
            <Dropdown.Item
              id={option.id}
              key={option.id}
              textValue={option.name}
            >
              <StatusChip status={option.id as Status} size="md" />
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
export function Dialog({
  title,
  description,
  onClose,
  children,
  size = "sm",
  placement,
  containerClassName,
  dialogClassName,
  headerEnd,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "full";
  placement?: "auto" | "center" | "top" | "bottom";
  containerClassName?: string;
  dialogClassName?: string;
  headerEnd?: ReactNode;
}) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container
          size={size}
          placement={placement}
          className={containerClassName}
        >
          <Modal.Dialog className={dialogClassName}>
            <Modal.CloseTrigger className="size-10" />
            <Modal.Header
              className={
                description
                  ? "flex-col items-start gap-1 pr-12"
                  : "flex-row items-center gap-3 pr-12"
              }
            >
              <div className="flex min-w-0 items-center gap-2">
                <Modal.Heading className="min-w-0 truncate">
                  {title}
                </Modal.Heading>
                {headerEnd}
              </div>
              {!!description && (
                <Typography
                  type="body-xs"
                  color="muted"
                  className="text-pretty"
                >
                  {description}
                </Typography>
              )}
            </Modal.Header>
            {children}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
