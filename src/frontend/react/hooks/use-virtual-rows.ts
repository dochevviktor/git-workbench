import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** Fixed-height rows keep the active descendant mounted and scroll keyboard targets before paint. */
export function useVirtualRows(count: number, activeIndex: number, rowHeight: number, enabled = true) {
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const virtual = enabled && count > 200;
  const update = useCallback(() => {
    const element = root.current;
    if (element) setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [update]);
  const indices = useMemo(() => {
    if (!virtual) return Array.from({ length: count }, (_, index) => index);
    const first = Math.max(0, Math.floor(viewport.top / rowHeight) - 8);
    const end = Math.min(count, Math.ceil((viewport.top + viewport.height) / rowHeight) + 8);
    const visible = new Set(Array.from({ length: Math.max(0, end - first) }, (_, index) => first + index));
    if (activeIndex >= 0 && activeIndex < count) visible.add(activeIndex);
    return [...visible].sort((left, right) => left - right);
  }, [activeIndex, count, rowHeight, viewport, virtual]);
  const reveal = useCallback(
    (index: number) => {
      const element = root.current;
      if (!virtual || !element) return;
      const top = index * rowHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + rowHeight > element.scrollTop + element.clientHeight)
        element.scrollTop = top + rowHeight - element.clientHeight;
      update();
    },
    [rowHeight, update, virtual],
  );
  return { root, virtual, indices, update, reveal };
}
