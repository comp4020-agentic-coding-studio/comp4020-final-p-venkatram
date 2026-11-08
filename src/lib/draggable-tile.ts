// Makes an absolutely-positioned element draggable via Pointer Events —
// mouse and touch through one code path, the same style piano-tool.ts
// already uses for press/release note handling (setPointerCapture +
// pointerup/pointercancel), rather than separate mouse/touch listener sets.
export interface DraggableOptions {
  // A drag never starts from a pointerdown on one of these — the tile's own
  // fullscreen button and status icons stay clickable rather than always
  // initiating a drag.
  ignoreSelector: string;
}

export function makeDraggable(el: HTMLElement, options: DraggableOptions): void {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  el.style.position = "absolute";
  el.style.touchAction = "none"; // otherwise the browser's own touch-scroll/zoom competes with pointermove

  el.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest(options.ignoreSelector)) return;
    dragging = true;
    el.setPointerCapture(event.pointerId);
    const elRect = el.getBoundingClientRect();
    offsetX = event.clientX - elRect.left;
    offsetY = event.clientY - elRect.top;
  });

  el.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const parent = (el.offsetParent as HTMLElement | null) ?? el.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    let left = event.clientX - parentRect.left - offsetX;
    let top = event.clientY - parentRect.top - offsetY;
    // Clamp so a dragged tile can't be lost off-viewport entirely.
    left = Math.max(0, Math.min(left, parentRect.width - elRect.width));
    top = Math.max(0, Math.min(top, parentRect.height - elRect.height));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });

  function endDrag(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    el.releasePointerCapture(event.pointerId);
  }
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}
