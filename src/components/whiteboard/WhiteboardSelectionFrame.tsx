import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SelectionBounds } from './whiteboardShared';
import { useI18n } from '../../hooks/useI18n';
import { BASE_CONTROL_SIZE, MIN_UI_SCREEN_PX, LockIcon } from './WhiteboardElementView';

interface WhiteboardSelectionFrameProps {
  /** World-space bounding box around every selected element. */
  bounds: SelectionBounds;
  cameraScale: number;
  /** True when every editable member is locked; the lock button then unlocks. */
  allLocked: boolean;
  canBringForward: boolean;
  canSendBackward: boolean;
  onDelete: () => void;
  onToggleLock: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onStartResize: (event: ReactPointerEvent) => void;
}

/**
 * Shared control frame for a multi-selection: one border around the marked
 * area carrying the action buttons that then apply to all selected elements
 * at once. Editing/cropping is deliberately not offered here.
 */
export function WhiteboardSelectionFrame({
  bounds,
  cameraScale,
  allLocked,
  canBringForward,
  canSendBackward,
  onDelete,
  onToggleLock,
  onBringForward,
  onSendBackward,
  onStartResize,
}: WhiteboardSelectionFrameProps) {
  const { t } = useI18n();
  // Same legibility compensation as the per-element overlay controls.
  const uiScale = Math.max(1, MIN_UI_SCREEN_PX / (BASE_CONTROL_SIZE * cameraScale));
  const lockLabel = t(
    allLocked ? 'whiteboard.selection.unlockAll' : 'whiteboard.selection.lockAll'
  );
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      <div className="absolute inset-0 rounded-lg border-2 border-[var(--accent)] bg-[var(--accent)]/5" />
      <button
        type="button"
        title={lockLabel}
        aria-label={lockLabel}
        onPointerDown={(e) => {
          if (e.button === 0) e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        className={`pointer-events-auto absolute z-10 flex items-center justify-center rounded-full text-white shadow hover:brightness-110 ${
          allLocked ? 'bg-[var(--warning)]' : 'bg-slate-600'
        }`}
        style={{
          width: 24 * uiScale,
          height: 24 * uiScale,
          left: -12 * uiScale,
          top: -12 * uiScale,
        }}
      >
        <LockIcon open={!allLocked} size={12 * uiScale} />
      </button>
      <button
        type="button"
        title={t('whiteboard.selection.deleteAll')}
        aria-label={t('whiteboard.selection.deleteAll')}
        onPointerDown={(e) => {
          if (e.button === 0) e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="pointer-events-auto absolute z-10 flex items-center justify-center rounded-full bg-[var(--danger)] p-0 text-white shadow hover:brightness-110"
        style={{
          width: 24 * uiScale,
          height: 24 * uiScale,
          right: -12 * uiScale,
          top: -12 * uiScale,
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={12 * uiScale}
          height={12 * uiScale}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {(
        [
          {
            title: t('whiteboard.selection.bringAllForward'),
            enabled: canBringForward,
            onClick: onBringForward,
            icon: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
          },
          {
            title: t('whiteboard.selection.sendAllBackward'),
            enabled: canSendBackward,
            onClick: onSendBackward,
            icon: <path d="M12 5v14m0 0 6-6m-6 6-6-6" />,
          },
        ] as const
      ).map((control, index) => (
        <button
          key={control.title}
          type="button"
          title={
            control.enabled
              ? control.title
              : t('whiteboard.selection.unavailableAction', { action: control.title })
          }
          aria-label={control.title}
          disabled={!control.enabled}
          onPointerDown={(e) => {
            if (e.button === 0) e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            control.onClick();
          }}
          className={`pointer-events-auto absolute z-10 flex items-center justify-center rounded-full bg-slate-600 p-0 text-white shadow ${
            control.enabled ? 'hover:brightness-110' : 'opacity-40'
          }`}
          style={{
            width: 24 * uiScale,
            height: 24 * uiScale,
            left: -12 * uiScale,
            top: (28 + index * 28) * uiScale,
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={14 * uiScale}
            height={14 * uiScale}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {control.icon}
          </svg>
        </button>
      ))}
      <div
        title={t('whiteboard.selection.scale')}
        aria-label={t('whiteboard.selection.scale')}
        onPointerDown={(e) => {
          // Right/middle presses fall through to the board pan.
          if (e.button !== 0) return;
          e.stopPropagation();
          onStartResize(e);
        }}
        className="pointer-events-auto absolute cursor-nwse-resize rounded-sm border-[var(--accent)] bg-[var(--panel)]"
        style={{
          width: 16 * uiScale,
          height: 16 * uiScale,
          right: -8 * uiScale,
          bottom: -8 * uiScale,
          borderWidth: Math.max(1.5, 2 * uiScale),
        }}
      />
    </div>
  );
}
