// src/components/ConfirmDialog.jsx
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * In-app confirmation for destructive actions. Replaces window.confirm so the
 * warning matches the rest of the UI and always offers a way out.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return
    const onKey = e => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 300,
          borderRadius: 'var(--rounded-md)',
          overflow: 'hidden',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          animation: 'rise 0.2s ease',
        }}
      >
        <div style={{ padding: '24px 17px 17px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 600, margin: '0 0 8px' }}>{title}</h2>
          <p style={{ fontSize: 'var(--type-subhead)', color: 'var(--ink-muted)', margin: 0, lineHeight: 1.43 }}>
            {message}
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            borderTop: '1px solid var(--line)',
          }}
        >
          <button
            onClick={onCancel}
            className="btn-quiet"
            style={{ flex: 1, borderRight: '1px solid var(--line)', borderRadius: 0, padding: 0 }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="btn-quiet"
            style={{
              flex: 1,
              color: destructive ? 'var(--destructive)' : 'var(--primary)',
              fontWeight: 600,
              borderRadius: 0,
              padding: 0,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
