/**
 * Client half of the screenshot bundle.
 *
 * A compact camera control in the composer tool row. It asks the host to run
 * one native capture, then hands the returned PNG to the composer's own file
 * intake by dispatching the document-level drop event the attachment surface
 * listens for. The image therefore lands as a pending draft attachment: it is
 * uploaded and previewed exactly like a dropped file, and nothing is sent until
 * the user submits.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-screenshot',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-screenshot'

    const zh = {
      button: '截图',
      busy: '正在截图…',
      hint: '截图：本窗口会隐藏，拖动选择区域，Esc 取消',
      failed: '截图失败',
      composerMissing: '没有找到输入框，图片无法放入草稿',
    }

    const en = {
      button: 'Screenshot',
      busy: 'Capturing…',
      hint: 'Screenshot: this window hides, drag a region, Esc cancels',
      failed: 'Screenshot failed',
      composerMissing: 'Composer not found, the image could not be attached',
    }

    /** Live translator; replaced with the locale-bound one during apply. */
    let t = (key) => key
    let noteTimer = 0

    /** Hand one PNG to the composer as a pending attachment. */
    function attachImage(dataUrl, name) {
      const comma = dataUrl.indexOf(',')
      const binary = atob(dataUrl.slice(comma + 1))
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

      const file = new File([bytes], name, { type: 'image/png' })
      const transfer = new DataTransfer()
      transfer.items.add(file)

      // The attachment surface owns a document-level drop target and routes the
      // files to the composer's intake; nothing here depends on its internals.
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      document.body.dispatchEvent(event)
      return document.body !== null
    }

    function stamp() {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    }

    function SnipButton() {
      const [phase, setPhase] = React.useState('idle')
      const [note, setNote] = React.useState('')
      const [hover, setHover] = React.useState(false)

      const flash = React.useCallback((message) => {
        setNote(message)
        setPhase('error')
        if (noteTimer !== 0) clearTimeout(noteTimer)
        noteTimer = setTimeout(() => {
          noteTimer = 0
          setPhase('idle')
          setNote('')
        }, 6000)
      }, [])

      const capture = React.useCallback(async () => {
        if (phase === 'busy') return
        setPhase('busy')
        setNote('')
        try {
          const response = await fetch('/dsh-screenshot/snip', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: document.title }),
          })
          const payload = await response.json().catch(() => null)
          if (payload === null) {
            flash(t('failed'))
            return
          }
          if (payload.ok !== true) {
            if (payload.reason === 'cancelled') {
              setPhase('idle')
              return
            }
            flash(payload.message || t('failed'))
            return
          }
          attachImage(payload.dataUrl, `screenshot-${stamp()}.png`)
          setPhase('idle')
        } catch (error) {
          flash(String(error && error.message ? error.message : error))
        }
      }, [phase, flash])

      const busy = phase === 'busy'
      const tint =
        phase === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : busy
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-label-secondary)'

      return h(
        'span',
        { style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-screenshot-button',
            title: busy ? t('busy') : phase === 'error' && note !== '' ? note : t('hint'),
            'aria-label': busy ? t('busy') : t('button'),
            'aria-busy': busy || undefined,
            disabled: busy,
            onClick: capture,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              background: hover && !busy ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
              color: tint,
              cursor: busy ? 'progress' : 'pointer',
              opacity: busy ? 0.6 : 1,
              transition: 'background .12s ease-out, color .12s ease-out',
            },
          },
          h(
            'svg',
            {
              width: 16,
              height: 16,
              viewBox: '0 0 16 16',
              fill: 'none',
              'aria-hidden': 'true',
              style: busy ? { animation: 'dsh-screenshot-pulse 1s ease-in-out infinite' } : undefined,
            },
            h('path', {
              d: 'M2 5.5V3.6A1.6 1.6 0 0 1 3.6 2h1.9M10.5 2h1.9A1.6 1.6 0 0 1 14 3.6v1.9M14 10.5v1.9a1.6 1.6 0 0 1-1.6 1.6h-1.9M5.5 14H3.6A1.6 1.6 0 0 1 2 12.4v-1.9',
              stroke: 'currentColor',
              strokeWidth: 1.4,
              strokeLinecap: 'round',
            }),
            h('circle', { cx: 8, cy: 8, r: 1.7, fill: 'currentColor', opacity: busy ? 0.4 : 0.9 }),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh))
        ctx.effect(() => ctx.locale.register(NS, 'en', en))
        const translate = ctx.locale.bind(NS)
        t = (key) => translate(key)

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'dsh-screenshot', order: 20 },
            SnipButton,
          ),
        )
      },
    }
  },
})
