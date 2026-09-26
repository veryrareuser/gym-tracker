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
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-float)',
          animation: 'rise 0.2s ease',
        }}
      >
        <div style={{ padding: '20px 18px 16px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'var(--type-headline)', fontWeight: 700, margin: '0 0 6px' }}>{title}</h2>
          <p style={{ fontSize: 'var(--type-footnote)', color: 'var(--color-muted)', margin: 0, lineHeight: 1.4 }}>
            {message}
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              minHeight: 44,
              color: 'var(--color-accent-text)',
              fontSize: 'var(--type-headline)',
              borderRight: '1px solid var(--color-border)',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              minHeight: 44,
              color: destructive ? 'var(--color-danger)' : 'var(--color-accent-text)',
              fontWeight: 600,
              fontSize: 'var(--type-headline)',
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
