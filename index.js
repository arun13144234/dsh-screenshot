/**
 * Host half of the screenshot bundle.
 *
 * One HTTP route drives the native capture helper: the helper hides the
 * calling page's browser window, freezes the screen, lets the user drag a
 * rectangle, restores the window, and writes a PNG. The route answers with the
 * image as a data URL so the client half can hand it to the composer.
 *
 * The capture only ever runs from this host process (a plain child of the DSH
 * runtime), never through the tool sandbox: cross-process window control is
 * refused inside that sandbox.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['webServer', 'connection']

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPTS = join(HERE, 'scripts')
const SNIP_PATH = '/dsh-screenshot/snip'
const POWERSHELL = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const CAPTURE_TIMEOUT_SECONDS = 120
/** The helper answers first; this only bounds a wedged process. */
const PROCESS_TIMEOUT_MS = (CAPTURE_TIMEOUT_SECONDS + 30) * 1000
const MAX_TITLE_CHARS = 200
const MAX_BODY_BYTES = 8 * 1024

/** Answer one JSON document. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** One PowerShell child; resolves instead of rejecting so timeouts stay answerable. */
function runPowerShell(args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(
        POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', ...args],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (error) {
      resolve({ code: -1, stdout, stderr: String(error), timedOut })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}${String(error)}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/** The helper prints exactly one JSON line; take the last parseable one. */
function readResultLine(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('{'))
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {
      // keep looking: Add-Type warnings can precede the answer
    }
  }
  return undefined
}

/** Read a bounded JSON body (or an empty object). */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return undefined
  }
}

/** Best-effort recovery: unhide whatever window the helper recorded. */
async function restoreWindow(targetFile) {
  try {
    await runPowerShell(['-File', join(SCRIPTS, 'restore.ps1'), '-TargetFile', targetFile], 20_000)
  } catch {
    // nothing left to try; the record file is removed below either way
  }
}

export function apply(ctx) {
  const rejection = (req, res) => {
    const status = ctx.connection.requestRejection(req)
    if (status === undefined) return false
    res.statusCode = status
    res.end()
    return true
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: SNIP_PATH,
      handler: async (req, res) => {
        if (rejection(req, res)) return
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'POST')
          res.end()
          return
        }
        if (
          String(req.headers['content-type'] ?? '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase() !== 'application/json'
        ) {
          sendJson(res, 415, { ok: false, reason: 'failed', message: 'content-type must be application/json' })
          return
        }
        const body = await readJsonBody(req)
        if (body === undefined) {
          sendJson(res, 400, { ok: false, reason: 'failed', message: 'request body unreadable' })
          return
        }

        const title = typeof body.title === 'string' ? body.title.slice(0, MAX_TITLE_CHARS) : ''
        // The hover panel picks per capture; absent means the default (hide).
        const hideWindow = body.hide !== false
        const id = randomUUID()
        const outPath = join(tmpdir(), `dsh-screenshot-${id}.png`)
        const targetFile = join(tmpdir(), `dsh-screenshot-${id}.hwnd`)

        try {
          const args = [
            '-File',
            join(SCRIPTS, 'snip.ps1'),
            '-OutPath',
            outPath,
            '-TargetFile',
            targetFile,
            '-TimeoutSeconds',
            String(CAPTURE_TIMEOUT_SECONDS),
            '-SourceDir',
            SCRIPTS,
          ]
          if (title !== '') args.push('-TitleFragment', title)
          if (!hideWindow) args.push('-HideWindow', '0')

          const run = await runPowerShell(args, PROCESS_TIMEOUT_MS)
          if (run.timedOut) {
            if (hideWindow) await restoreWindow(targetFile)
            sendJson(res, 200, {
              ok: false,
              reason: 'failed',
              message: 'capture helper timed out and the window was restored',
            })
            return
          }

          const result = readResultLine(run.stdout)
          if (result === undefined) {
            if (hideWindow) await restoreWindow(targetFile)
            const detail = run.stderr.trim().split(/\r?\n/).slice(-3).join(' ')
            sendJson(res, 200, {
              ok: false,
              reason: 'failed',
              message: detail === '' ? `capture helper exited with code ${run.code}` : detail,
            })
            return
          }
          if (result.ok !== true) {
            sendJson(res, 200, {
              ok: false,
              reason: typeof result.reason === 'string' && result.reason !== '' ? result.reason : 'failed',
              message: typeof result.message === 'string' ? result.message : '',
            })
            return
          }

          const bytes = await readFile(outPath)
          sendJson(res, 200, {
            ok: true,
            dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
            width: result.width,
            height: result.height,
            bytes: bytes.length,
          })
        } catch (error) {
          if (hideWindow) await restoreWindow(targetFile)
          sendJson(res, 200, { ok: false, reason: 'failed', message: String(error) })
        } finally {
          await rm(outPath, { force: true }).catch(() => {})
          await rm(targetFile, { force: true }).catch(() => {})
        }
      },
    }),
  )
}
