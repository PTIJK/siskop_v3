import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export function SetupSpotlight({ routeKey, inSettings, onGuideTab }: {
  routeKey: string;
  inSettings: boolean;
  onGuideTab: boolean;
}) {
  const [bounds, setBounds] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>("[data-setup-shell]");
    if (!shell) return;

    const skip = shell.querySelector<HTMLElement>("[data-setup-skip]");
    let target: HTMLElement | undefined;
    let frame = 0;
    const disabled = new Set<HTMLElement>();
    const watchSize = new ResizeObserver(schedule);

    function restore() {
      for (const element of disabled) element.inert = false;
      disabled.clear();
    }

    function disableOutside(branch: HTMLElement, active: HTMLElement) {
      for (const child of branch.children) {
        if (!(child instanceof HTMLElement) || child === active || child === skip || child.inert) continue;
        if (child.contains(active) || (skip && child.contains(skip))) {
          disableOutside(child, active);
        } else {
          child.inert = true;
          disabled.add(child);
        }
      }
    }

    function show() {
      const dialogOpen = document.querySelector('[data-setup-dialog][data-state="open"]');
      const drawer = shell!.querySelector<HTMLElement>('#sidebar-mobile[role="dialog"]');
      const targetNames = onGuideTab ? ["form", "add"] : inSettings
        ? ["tab", "tab-select"]
        : drawer ? ["settings-link", "settings-group"] : ["settings-link", "settings-group", "menu"];
      const scope = drawer && !inSettings ? drawer : shell!;
      const next = dialogOpen ? undefined : targetNames.flatMap((name) =>
        Array.from(scope.querySelectorAll<HTMLElement>(`[data-setup-target="${name}"]`))
      ).find((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));

      if (next !== target) {
        restore();
        watchSize.disconnect();
        target = next;
        if (target) {
          disableOutside(shell!, target);
          watchSize.observe(target);
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
          target.focus({ preventScroll: true });
        }
      }

      const rect = target?.getBoundingClientRect() ?? null;
      setBounds((previous) => previous?.x === rect?.x && previous?.y === rect?.y &&
        previous?.width === rect?.width && previous?.height === rect?.height ? previous : rect);
    }

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(show);
    }

    const changes = new MutationObserver(schedule);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "aria-modal", "data-state", "data-setup-target"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    shell.addEventListener("transitionend", schedule);
    show();

    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      watchSize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      shell.removeEventListener("transitionend", schedule);
      restore();
    };
  }, [routeKey, inSettings, onGuideTab]);

  if (!bounds) return null;

  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[51] overflow-hidden">
      <div
        className="absolute rounded-xl ring-2 ring-primary"
        style={{
          left: bounds.left - 4,
          top: bounds.top - 4,
          width: bounds.width + 8,
          height: bounds.height + 8,
          boxShadow: "0 0 0 200vmax rgb(0 0 0 / 70%)"
        }}
      />
    </div>,
    document.body
  );
}
