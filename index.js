import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

export const inject = ['webServer']
export const name = 'rail-pulse'

const BANDS = 46
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CFG_DIR = join(DSH_HOME, 'rail-pulse')
const CFG_FILE = join(CFG_DIR, 'config.json')
const DEFAULTS = { visible: true, gain: 1, scale: 1, motion: 0.6, smoothing: 0.65, colorful: true, color: '#e8e8e8' }

function readCfg() {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(CFG_FILE, 'utf8')) } } catch { return { ...DEFAULTS } }
}
function pickCfg(o) {
  const out = {}
  if (typeof o.visible === 'boolean') out.visible = o.visible
  if (typeof o.colorful === 'boolean') out.colorful = o.colorful
  if (typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)) out.color = o.color
  if (typeof o.gain === 'number' && isFinite(o.gain)) out.gain = Math.max(0.3, Math.min(3, o.gain))
  if (typeof o.smoothing === 'number' && isFinite(o.smoothing)) out.smoothing = Math.max(0.05, Math.min(0.8, o.smoothing))
  if (typeof o.scale === 'number' && isFinite(o.scale)) out.scale = Math.max(0.5, Math.min(1.8, o.scale))
  if (typeof o.motion === 'number' && isFinite(o.motion)) out.motion = Math.max(0.1, Math.min(1, o.motion))
  return out
}

export function apply(ctx) {
  const dir = dirname(fileURLToPath(import.meta.url))
  const tapBin = join(dir, 'bin', 'railpulse-tap')
  const sckBin = join(dir, 'bin', 'railpulse-audio')
  let useTap = existsSync(tapBin)
  let latest = { bands: new Array(BANDS).fill(0) }
  let cfg = readCfg()

  function saveCfg(next) {
    cfg = next
    try { mkdirSync(CFG_DIR, { recursive: true }); writeFileSync(CFG_FILE, JSON.stringify(next, null, 2)) }
    catch (e) { console.error('[rail-pulse] save config failed', e?.message || e) }
  }

  ctx.effect(() => {
    let disposed = false
    let child = null
    let buf = ''
    let fails = 0
    let startedAt = 0
    const start = () => {
      const bin = useTap ? tapBin : sckBin
      startedAt = Date.now()
      child = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] })
      child.stderr.on('data', (d) => console.error('[rail-pulse]', String(d).trim()))
      child.on('error', (e) => console.error('[rail-pulse] spawn failed:', e.message))
      child.on('exit', (code) => {
        console.error('[rail-pulse] helper exited', code)
        if (!disposed && useTap && code !== 0 && Date.now() - startedAt < 4000) {
          fails += 1
          if (fails >= 2) { useTap = false; fails = 0 }
        }
        if (!disposed) setTimeout(start, 1200)
      })
      child.stdout.on('data', (d) => {
        buf += d.toString()
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          try { const o = JSON.parse(line); if (Array.isArray(o.bands)) latest = o } catch {}
        }
      })
    }
    start()
    return () => { disposed = true; try { child?.kill() } catch {} }
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/rail-pulse',
    handler: (req, res) => {
      const url = (req.url || '').split('?')[0]
      if (url === '/rail-pulse/levels') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(latest))
        return
      }
      if (url === '/rail-pulse/config') {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy() })
          req.on('end', () => {
            try { saveCfg({ ...cfg, ...pickCfg(JSON.parse(body || '{}')) }) } catch {}
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(JSON.stringify(cfg))
          })
          return
        }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(cfg))
        return
      }
      res.writeHead(404); res.end()
    }
  }))
}
