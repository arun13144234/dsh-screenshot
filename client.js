/**
 * Client half of the screenshot bundle.
 *
 * A compact camera control in the composer tool row. Hovering it for a moment
 * opens a two-row panel that picks how the capture treats this window: hide it
 * first (the default, so the region you drag covers the desktop behind), or
 * keep it (so you can crop the page itself). A plain click on the icon runs
 * whichever mode was used last.
 *
 * The PNG reaches the composer through the document-level drop target the
 * attachment surface installs, so it uploads and previews exactly like a
 * dropped file, and nothing is sent until the user submits.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-screenshot',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-screenshot'
    const MODE_KEY = 'dsh-screenshot:mode'

    const zh = {
      button: '截图',
      busy: '正在截图…',
      hint: '截图：本窗口会隐藏，拖动选择区域，Esc 取消',
      failed: '截图失败',
      optionHide: '隐藏窗口后截图',
      optionHideHint: '窗口先让开，截它背后的桌面',
      optionKeep: '保持窗口截图',
      optionKeepHint: '直接截当前画面，包含本窗口',
    }

    const en = {
      button: 'Screenshot',
      busy: 'Capturing…',
      hint: 'Screenshot: this window hides, drag a region, Esc cancels',
      failed: 'Screenshot failed',
      optionHide: 'Hide the window first',
      optionHideHint: 'The window steps aside; crop the desktop behind it',
      optionKeep: 'Keep the window',
      optionKeepHint: 'Crop the current screen, this window included',
    }

    /** Live translator; replaced with the locale-bound one during apply. */
    let t = (key) => key
    let noteTimer = 0

    function readMode() {
      try {
        return localStorage.getItem(MODE_KEY) === 'keep' ? 'keep' : 'hide'
      } catch {
        return 'hide'
      }
    }

    function writeMode(mode) {
      try {
        localStorage.setItem(MODE_KEY, mode)
      } catch {
        // a blocked storage quota only costs the remembered choice
      }
    }

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
    }

    function stamp() {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    }

    function ModeRow({ active, label, hint, onPick }) {
      const [hover, setHover] = React.useState(false)
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': active,
          onClick: onPick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'block',
            width: '100%',
            padding: '6px 8px',
            border: 'none',
            borderRadius: 7,
            background: hover ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
          },
        },
        h(
          'span',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              lineHeight: '16px',
              fontWeight: active ? 600 : 400,
            },
          },
          h(
            'span',
            {
              'aria-hidden': 'true',
              style: {
                width: 12,
                flex: '0 0 12px',
                color: 'var(--dsw-alias-brand-primary)',
                opacity: active ? 1 : 0,
              },
            },
            '✓',
          ),
          label,
        ),
        h(
          'span',
          {
            style: {
              display: 'block',
              marginLeft: 18,
              fontSize: 11,
              lineHeight: '15px',
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          hint,
        ),
      )
    }

    function SnipButton() {
      const [phase, setPhase] = React.useState('idle')
      const [note, setNote] = React.useState('')
      const [hover, setHover] = React.useState(false)
      const [panel, setPanel] = React.useState(false)
      const [mode, setMode] = React.useState(readMode)
      const openTimer = React.useRef(0)
      const closeTimer = React.useRef(0)

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

      const capture = React.useCallback(
        async (chosen) => {
          if (phase === 'busy') return
          setPanel(false)
          setPhase('busy')
          setNote('')
          try {
            const response = await fetch('/dsh-screenshot/snip', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ title: document.title, hide: chosen === 'hide' }),
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
        },
        [phase, flash],
      )

      const pick = (chosen) => {
        setMode(chosen)
        writeMode(chosen)
        capture(chosen)
      }

      const openLater = () => {
        setHover(true)
        clearTimeout(closeTimer.current)
        clearTimeout(openTimer.current)
        openTimer.current = setTimeout(() => setPanel(true), 280)
      }

      const closeLater = () => {
        clearTimeout(openTimer.current)
        clearTimeout(closeTimer.current)
        closeTimer.current = setTimeout(() => {
          setPanel(false)
          setHover(false)
        }, 180)
      }

      const busy = phase === 'busy'
      const tint =
        phase === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : busy
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-label-secondary)'

      return h(
        'span',
        {
          onMouseEnter: openLater,
          onMouseLeave: closeLater,
          style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
        },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-screenshot-button',
            title: busy ? t('busy') : phase === 'error' && note !== '' ? note : t('hint'),
            'aria-label': busy ? t('busy') : t('button'),
            'aria-haspopup': 'menu',
            'aria-expanded': panel || undefined,
            'aria-busy': busy || undefined,
            disabled: busy,
            onClick: () => capture(mode),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              background: hover ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
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
            },
            h('path', {
              d: 'M2 5.5V3.6A1.6 1.6 0 0 1 3.6 2h1.9M10.5 2h1.9A1.6 1.6 0 0 1 14 3.6v1.9M14 10.5v1.9a1.6 1.6 0 0 1-1.6 1.6h-1.9M5.5 14H3.6A1.6 1.6 0 0 1 2 12.4v-1.9',
              stroke: 'currentColor',
              strokeWidth: 1.4,
              strokeLinecap: 'round',
            }),
            h('circle', { cx: 8, cy: 8, r: 1.7, fill: 'currentColor', opacity: 0.9 }),
          ),
        ),
        panel && !busy
          ? h(
              'div',
              {
                role: 'menu',
                'aria-label': t('button'),
                // The 8px padding is the hover bridge: it keeps the pointer
                // inside this subtree while it travels from the icon to the card.
                style: {
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  paddingTop: 8,
                  zIndex: 40,
                },
              },
              h(
                'div',
                {
                  style: {
                    width: 232,
                    padding: 4,
                    borderRadius: 10,
                    background: 'var(--dsw-alias-bg-overlay)',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    boxShadow: '0 10px 28px rgba(0, 0, 0, .22)',
                  },
                },
                h(ModeRow, {
                  active: mode === 'hide',
                  label: t('optionHide'),
                  hint: t('optionHideHint'),
                  onPick: () => pick('hide'),
                }),
                h(ModeRow, {
                  active: mode === 'keep',
                  label: t('optionKeep'),
                  hint: t('optionKeepHint'),
                  onPick: () => pick('keep'),
                }),
              ),
            )
          : null,
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
