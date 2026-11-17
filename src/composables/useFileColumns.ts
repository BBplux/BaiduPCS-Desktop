import { computed, onBeforeUnmount, ref } from "vue";

export function useFileColumns() {
  const table = ref<HTMLTableElement | null>(null);
  // The selection checkbox is a separate 44px column in our table.
  const minimums = [256, 100, 100, 150];
  const widths = ref<number[] | null>(null);
  const resizing = ref<number | null>(null);
  let release: (() => void) | undefined;
  const tableStyle = computed(() =>
    widths.value
      ? {
          width: `${44 + widths.value.reduce((sum, width) => sum + width, 0)}px`,
        }
      : undefined,
  );
  function measure() {
    return Array.from(
      table.value!.querySelectorAll<HTMLTableCellElement>("thead th"),
    )
      .slice(1)
      .map((cell) => cell.getBoundingClientRect().width);
  }
  function stop() {
    release?.();
  }
  function start(event: PointerEvent, index: number) {
    if (event.button !== 0 || !event.isPrimary || !table.value) return;
    stop();
    const handle = event.currentTarget as HTMLElement;
    const initial = measure();
    const origin = event.clientX;
    const viewport = table.value.closest(".file-list-viewport")!;
    const initialScroll = viewport.scrollLeft;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const delta = next.clientX - origin + viewport.scrollLeft - initialScroll;
      // Merely clicking a boundary leaves automatic sizing intact.
      if (!widths.value && Math.abs(delta) < 1) return;
      const updated = [...initial];
      updated[index] = Math.max(minimums[index]!, initial[index]! + delta);
      widths.value = updated;
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId === event.pointerId) stop();
    };
    release = () => {
      release = undefined;
      resizing.value = null;
      document.body.classList.remove("file-columns-resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      window.removeEventListener("blur", stop);
      if (handle.hasPointerCapture(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
    };
    resizing.value = index;
    document.body.classList.add("file-columns-resizing");
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    window.addEventListener("blur", stop);
    handle.setPointerCapture(event.pointerId);
  }
  function keyboard(event: KeyboardEvent, index: number) {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !table.value)
      return;
    event.preventDefault();
    const updated = measure();
    updated[index] = Math.max(
      minimums[index]!,
      updated[index]! + (event.key === "ArrowLeft" ? -10 : 10),
    );
    widths.value = updated;
  }
  onBeforeUnmount(stop);
  return {
    table,
    widths,
    resizing,
    minimums,
    tableStyle,
    start,
    stop,
    keyboard,
  };
}
