import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  position?: 'top' | 'bottom';
}

const gap = 8;

function mergeHandler<E extends React.SyntheticEvent>(own: (e: E) => void, child?: (e: E) => void) {
  return (e: E) => {
    child?.(e);
    own(e);
  };
}

export function Tooltip({ children, content, position = 'top' }: TooltipProps) {
  const baseId = useId();
  const tooltipId = `tooltip-${baseId}`;
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let top: number;
    if (position === 'top') {
      top = triggerRect.top - tooltipRect.height - gap;
    } else {
      top = triggerRect.bottom + gap;
    }

    let left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
    left = Math.max(gap, Math.min(left, window.innerWidth - tooltipRect.width - gap));

    setStyle({ top, left, position: 'fixed' });
  }, [visible, position]);

  useEffect(() => {
    if (!visible) return;

    const hide = () => setVisible(false);
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('scroll', hide);
      window.removeEventListener('resize', hide);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [visible]);

  const tooltip = (
    <div
      ref={tooltipRef}
      id={tooltipId}
      style={style}
      className="z-50 max-w-[260px] rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] shadow-lg"
      role="tooltip"
    >
      {content}
      <span
        className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-[var(--border)] bg-[var(--panel)] ${
          position === 'top' ? '-bottom-1 border-b border-r' : '-top-1 border-l border-t'
        }`}
      />
    </div>
  );

  const trigger = (
    <span
      ref={triggerRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      className="relative"
    >
      {children}
    </span>
  );

  if (React.isValidElement<React.HTMLAttributes<HTMLElement>>(children)) {
    const show = () => setVisible(true);
    const hide = () => setVisible(false);

    const cloned = React.cloneElement(children, {
      'aria-describedby': visible ? tooltipId : undefined,
      onMouseEnter: mergeHandler(show, children.props.onMouseEnter),
      onMouseLeave: mergeHandler(hide, children.props.onMouseLeave),
      onFocus: mergeHandler(show, children.props.onFocus),
      onBlur: mergeHandler(hide, children.props.onBlur),
    });

    return (
      <>
        <span ref={triggerRef} className="relative">
          {cloned}
        </span>
        {visible && createPortal(tooltip, document.body)}
      </>
    );
  }

  return (
    <>
      {trigger}
      {visible && createPortal(tooltip, document.body)}
    </>
  );
}
