import { useLayoutEffect, useMemo, useState, type ComponentProps } from "react";
import { Button, Popover } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { ActivityBloub } from "./ActivityBloub";
import {
  firstRunPath,
  type FirstRunContext,
  type FirstRunStep,
} from "./first-run";

type Placement = NonNullable<
  ComponentProps<typeof Popover.Content>["placement"]
>;

export function FirstRunCoachMark({
  step,
  context,
  placement,
  onNext,
  onEnd,
}: {
  step: FirstRunStep;
  context: FirstRunContext;
  placement: Placement;
  onNext: () => void;
  onEnd: () => void;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [covered, setCovered] = useState(false);

  /* Anchors are permanent controls, but they mount and unmount as the UI moves
     around them: the header button swaps label with the first project, the
     board dock only exists on the board, and the sidebar re-renders. So resolve
     the target on every DOM change rather than once. */
  useLayoutEffect(() => {
    let frame = 0;
    let current: HTMLElement | null = null;
    const resolve = () => {
      // A dialog or drawer in front of the control owns the screen; the bubble
      // waits behind it rather than pointing at something under a backdrop.
      setCovered(
        document.querySelector(
          '[data-slot="modal-backdrop"], [data-slot="drawer-backdrop"]',
        ) !== null,
      );
      const found = document.querySelector<HTMLElement>(
        `[data-tour="${step}"]`,
      );
      if (found === current) return;
      if (current) delete current.dataset.tourActive;
      current = found;
      if (current) current.dataset.tourActive = "true";
      setAnchor(found);
    };
    resolve();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resolve);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (current) delete current.dataset.tourActive;
    };
  }, [step]);

  const triggerRef = useMemo(() => ({ current: anchor }), [anchor]);
  const path = firstRunPath(context);
  const index = path.indexOf(step);

  if (!anchor || covered) return null;

  return (
    /* Standalone Popover.Content, without the Popover root: the root is a
       react-aria DialogTrigger, which warns when it has no pressable child.
       react-aria's Popover positions itself from `triggerRef` instead. The
       literal `popover` class is what the root would otherwise have added, and
       the stylesheet keys the arrow rotation and the enter animation on it. */
    <Popover.Content
      key={step}
      isOpen
      onOpenChange={() => undefined}
      triggerRef={triggerRef}
      placement={placement}
      offset={12}
      isNonModal
      shouldFlip
      className="popover first-run-popover w-[min(320px,calc(100vw-24px))]"
    >
      <Popover.Dialog className="popover__dialog first-run-popover__dialog">
        <Popover.Arrow />
        <div className="first-run-popover__lead">
          <div className="min-w-0">
            <div className="first-run-popover__eyebrow">
              {t("tour.progress", {
                current: index + 1,
                total: path.length,
              })}
            </div>
            <Popover.Heading className="first-run-popover__heading">
              {t(`tour.${step}Title`)}
            </Popover.Heading>
          </div>
          <span className="first-run-popover__agent">
            <ActivityBloub
              brand="guide"
              label="Wireal"
              ariaLabel={t("tour.agentLabel")}
              delay={index}
            />
          </span>
        </div>
        <p className="first-run-popover__description">
          {t(`tour.${step}Description`)}
        </p>
        <div className="first-run-popover__actions">
          <Button
            size="sm"
            variant="tertiary"
            className="first-run-popover__end"
            onPress={onEnd}
          >
            {t("tour.end")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="first-run-popover__next"
            onPress={onNext}
          >
            {index === path.length - 1 ? t("tour.done") : t("tour.next")}
          </Button>
        </div>
      </Popover.Dialog>
    </Popover.Content>
  );
}
