import { Children, isValidElement, useLayoutEffect, useMemo, useState } from 'react';
import { GridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem, ResizeHandleAxis } from 'react-grid-layout';

interface DashboardLayoutProps {
  storageKey?: string;
  defaultLayout: LayoutItem[];
  children: React.ReactNode;
  className?: string;
  cols?: number;
  rowHeight?: number;
  margin?: [number, number];
  containerPadding?: [number, number];
  backgroundPattern?: boolean;
  dragHandle?: string;
  resizeHandle?: ResizeHandleAxis[];
  fitHeight?: boolean;
}

const DEFAULT_MARGIN: [number, number] = [16, 16];
const DEFAULT_PADDING: [number, number] = [0, 0];
const DEFAULT_RESIZE_HANDLE: ResizeHandleAxis[] = ['se'];

function clampLayout(layout: LayoutItem[], maxRows: number): LayoutItem[] {
  return layout.map((item) => {
    const minH = item.minH ?? 1;
    const maxAvailableH = Math.max(maxRows - item.y, minH);
    const h = Math.max(minH, Math.min(item.h, maxAvailableH));
    return { ...item, h };
  });
}

export function DashboardLayout({
  storageKey,
  defaultLayout,
  children,
  className = '',
  cols = 12,
  rowHeight = 60,
  margin = DEFAULT_MARGIN,
  containerPadding = DEFAULT_PADDING,
  backgroundPattern = true,
  dragHandle = '.grid-panel-header',
  resizeHandle = DEFAULT_RESIZE_HANDLE,
  fitHeight = false,
}: DashboardLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const [containerHeight, setContainerHeight] = useState(0);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      setContainerHeight(node.clientHeight);
    };

    update();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(node);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [containerRef]);

  const maxRows = useMemo(() => {
    if (!fitHeight || containerHeight <= 0) return Infinity;
    const [_, marginY] = margin;
    return Math.max(1, Math.floor((containerHeight + marginY) / (rowHeight + marginY)));
  }, [fitHeight, containerHeight, rowHeight, margin]);

  const [savedLayout, setSavedLayout] = useState<Layout>(() => {
    if (!storageKey) return defaultLayout;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return defaultLayout;
  });

  const visibleKeys = useMemo(() => {
    const keys: string[] = [];
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.key !== null) {
        keys.push(String(child.key));
      }
    });
    return keys;
  }, [children]);

  const layout = useMemo(() => {
    const saved = new Map(savedLayout.map((l) => [l.i, l]));
    const defaults = new Map(defaultLayout.map((l) => [l.i, l]));
    const base = visibleKeys.map((key) => {
      return saved.get(key) ?? defaults.get(key) ?? { i: key, x: 0, y: 0, w: 3, h: 4 };
    });
    return fitHeight && Number.isFinite(maxRows) ? clampLayout(base, maxRows) : base;
  }, [savedLayout, visibleKeys, defaultLayout, fitHeight, maxRows]);

  const handleLayoutChange = (newLayout: Layout) => {
    setSavedLayout((prev) => {
      const map = new Map(prev.map((l) => [l.i, l]));
      for (const item of newLayout) {
        map.set(item.i, item);
      }
      const next = Array.from(map.values());
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  return (
    <div
      ref={containerRef}
      className={`h-full w-full ${className}`}
      style={
        backgroundPattern
          ? {
              backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }
          : undefined
      }
    >
      {mounted && (
        <GridLayout
          className="dashboard-grid-layout"
          width={width}
          layout={layout}
          gridConfig={{
            cols,
            rowHeight,
            margin,
            containerPadding,
            maxRows,
          }}
          dragConfig={{ handle: dragHandle }}
          resizeConfig={{ handles: resizeHandle }}
          onLayoutChange={handleLayoutChange}
          autoSize
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}
