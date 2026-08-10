import { Children, useState, type ReactElement, type ReactNode, isValidElement } from 'react';

interface SideDrawerItemProps {
  id: string;
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function SideDrawerItem({ children }: SideDrawerItemProps) {
  return <>{children}</>;
}

interface SideDrawerProps {
  side?: 'left' | 'right';
  width?: string;
  maxWidth?: string;
  fitContent?: boolean;
  children: ReactNode;
}

export function SideDrawer({ side = 'right', width = '18rem', maxWidth = 'calc(100vw - 16rem)', fitContent = false, children }: SideDrawerProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = Children.toArray(children).filter(isValidElement<SideDrawerItemProps>) as ReactElement<SideDrawerItemProps>[];
  const activeItem = items.find((item) => item.props.id === activeId);

  const isRight = side === 'right';

  // For a right drawer the buttons sit on the left and the content slides out
  // towards the right edge. Mirrored for the left side.
  const contentAfterButtons = isRight;
  const open = activeId !== null;

  const rail = (
    <div
      className={`flex flex-col items-start self-start ${
        isRight ? 'rounded-bl-lg border-l' : 'rounded-br-lg border-r'
      } border-[var(--border)] bg-[var(--panel)]`}
    >
      {items.map((item, index) => {
        const isActive = item.props.id === activeId;
        const isLast = index === items.length - 1;
        const isFirst = index === 0;
        return (
          <button
            key={item.props.id}
            type="button"
            onClick={() => setActiveId(isActive ? null : item.props.id)}
            className={`flex w-max items-center gap-2 whitespace-nowrap bg-[var(--panel)] px-4 py-2 text-sm font-medium transition ${
              isFirst ? 'border-t border-[var(--border)]' : ''
            } ${
              isLast
                ? (isRight
                    ? 'rounded-bl-lg'
                    : 'rounded-br-lg') + ' border-b border-[var(--border)]'
                : 'border-b border-[var(--border)]'
            } ${
              isActive
                ? 'bg-slate-800 text-[var(--text-h)] ring-2 ring-inset ring-[var(--accent)]'
                : 'text-slate-400 hover:bg-slate-800 hover:text-[var(--text-h)]'
            }`}
          >
            {item.props.icon}
            <span className="hidden sm:inline">{item.props.label}</span>
          </button>
        );
      })}
    </div>
  );

  // Content is either a fixed width or auto-sized to fit its children (wide content).
  const contentWidth = fitContent ? 'max-content' : width;
  const contentStyle = fitContent
    ? { width: activeId ? 'max-content' : 0, maxWidth: activeId ? maxWidth : 0 }
    : { width: activeId ? width : 0 };

  const content = (
    <div
      className={`overflow-hidden transition-[width,min-width,max-width] duration-300 ${
        isRight ? 'border-l' : 'border-r'
      } border-[var(--border)]`}
      style={contentStyle}
    >
      <div
        className="h-full overflow-auto bg-[var(--panel)] p-4 shadow-2xl"
        style={{ width: contentWidth, minWidth: '100%' }}
      >
        {activeItem?.props.children}
      </div>
    </div>
  );

  // Modal-like backdrop: dims everything below the header and closes the drawer on click.
  const backdrop = (
    <div
      className="fixed left-0 right-0 z-30 bg-black/50 transition-opacity duration-300"
      style={{
        top: 'var(--header-height)',
        bottom: 0,
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={() => setActiveId(null)}
    />
  );

  return (
    <>
      {backdrop}
      <div className="fixed z-40 flex" style={{ top: 'calc(var(--header-height) - 1px)', bottom: 0, [side]: 0 }}>
        {contentAfterButtons ? (
          <>
            {rail}
            {content}
          </>
        ) : (
          <>
            {content}
            {rail}
          </>
        )}
      </div>
    </>
  );
}
