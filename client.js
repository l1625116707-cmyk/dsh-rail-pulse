window.__ModuleLoader__.load({
  id: 'dsh-rail-pulse',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const BARS = 46;
    const WIDTH = 38;

    function RailPulse() {
      const canvasRef = React.useRef(null);
      const rootRef = React.useRef(null);
      const levelsRef = React.useRef(new Array(BARS).fill(0));
      const targetRef = React.useRef(new Array(BARS).fill(0));
      const cfgRef = React.useRef({ visible: true, gain: 1, smoothing: 0.35, colorful: true, color: '#e8e8e8' });
      const rafRef = React.useRef(0);
      const [cfg, setCfg] = React.useState({ visible: true, gain: 1, smoothing: 0.35, colorful: true, color: '#e8e8e8' });
      const [open, setOpen] = React.useState(false);
      const [status, setStatus] = React.useState('连接中');

      cfgRef.current = cfg;

      React.useEffect(() => {
        let alive = true;
        fetch('/rail-pulse/config', { cache: 'no-store' })
          .then((r) => r.ok ? r.json() : null)
          .then((o) => { if (alive && o) setCfg((c) => ({ ...c, ...o })); })
          .catch(() => {});
        return () => { alive = false; };
      }, []);

      const save = (patch) => {
        setCfg((c) => {
          const next = { ...c, ...patch };
          fetch('/rail-pulse/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next)
          }).catch(() => {});
          return next;
        });
      };

      React.useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const r = await fetch('/rail-pulse/levels', { cache: 'no-store' });
            if (r.ok) {
              const o = await r.json();
              if (Array.isArray(o.bands) && o.bands.length === BARS) {
                const gain = cfgRef.current.gain;
                targetRef.current = o.bands.map((v) => Math.min(1, v * gain));
                const peak = Math.max(...targetRef.current);
                if (alive) setStatus(peak > 0.05 ? '跟随系统音频' : '等待音频');
              }
            }
          } catch (e) {
            if (alive) setStatus('采集未就绪');
          }
          if (alive) setTimeout(tick, 40);
        };
        tick();
        return () => { alive = false; };
      }, []);

      React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const resize = () => {
          const h = rootRef.current ? rootRef.current.clientHeight : window.innerHeight;
          canvas.width = WIDTH * dpr;
          canvas.height = h * dpr;
          canvas.style.width = WIDTH + 'px';
          canvas.style.height = h + 'px';
        };
        resize();
        const ro = new ResizeObserver(resize);
        if (rootRef.current) ro.observe(rootRef.current);
        window.addEventListener('resize', resize);
        const g = canvas.getContext('2d');
        const draw = () => {
          const H = canvas.clientHeight || window.innerHeight;
          const levels = levelsRef.current;
          const targets = targetRef.current;
          const smooth = cfgRef.current.smoothing;
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.clearRect(0, 0, WIDTH, H);
          const gap = Math.min(10, Math.max(6, (H - 32) / (BARS - 1)));
          const barH = 2.4;
          const top = Math.max(16, (H - gap * (BARS - 1) - barH) / 2);
          for (let i = 0; i < BARS; i++) {
            levels[i] += (targets[i] - levels[i]) * smooth;
            const v = Math.max(0.03, Math.min(1, levels[i]));
            const w = 6 + v * 26;
            const x = WIDTH - 6 - w;
            const y = top + i * gap;
            const colorful = cfgRef.current.colorful;
            if (colorful) {
              const hue = ((i / BARS) * 320 + (performance.now() / 1000) * 18) % 360;
              g.shadowColor = 'hsla(' + hue + ', 95%, 60%, ' + (0.25 + v * 0.55) + ')';
              g.shadowBlur = 4 + v * 12;
              g.globalAlpha = 0.35 + v * 0.65;
              g.fillStyle = 'hsl(' + hue + ' 92% ' + (54 + v * 18) + '%)';
            } else {
              g.shadowBlur = 0;
              g.globalAlpha = 0.22 + v * 0.78;
              g.fillStyle = cfgRef.current.color || '#e8e8e8';
            }
            g.beginPath();
            if (g.roundRect) g.roundRect(x, y, w, barH, 1.4);
            else g.rect(x, y, w, barH);
            g.fill();
          }
          g.globalAlpha = 1;
          g.shadowBlur = 0;
          rafRef.current = requestAnimationFrame(draw);
        };
        draw();
        return () => {
          cancelAnimationFrame(rafRef.current);
          window.removeEventListener('resize', resize);
          ro.disconnect();
        };
      }, []);

      const panelStyle = {
        position: 'fixed', right: WIDTH + 14, bottom: 52, width: 238,
        zIndex: 61, pointerEvents: 'auto',
        background: 'var(--dsw-alias-bg-overlay, rgba(24,24,26,0.94))', color: 'var(--dsw-alias-label-primary, #f2f2f2)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))', borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)', backdropFilter: 'blur(18px)',
        padding: '12px 13px 11px',
        font: '12px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
      };
      const btnStyle = {
        pointerEvents: 'auto', cursor: 'pointer', border: 'none', borderRadius: 999,
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.20))', color: 'var(--dsw-alias-label-primary, #ddd)',
        font: '12px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        padding: '6px 9px', backdropFilter: 'blur(8px)'
      };
      const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0' };
      const label = { opacity: 1, fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #8a8a8a)' };
      const slider = { width: 118, accentColor: 'var(--dsw-alias-brand-primary, #8ab4ff)' };

      return h('div', {
        ref: rootRef,
        style: {
          position: 'fixed', right: 0, top: 0, bottom: 0, width: WIDTH,
          zIndex: 60, pointerEvents: 'none',
          background: cfg.visible ? 'var(--dsw-alias-bg-base, #0b0b0b)' : 'transparent',
          borderLeft: cfg.visible ? '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.18))' : 'none'
        }
      },
        h('canvas', { ref: canvasRef, style: { display: 'block', opacity: cfg.visible ? 1 : 0, transition: 'opacity .2s' } }),
        h('div', {
          style: { position: 'fixed', right: 8, bottom: 12, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }
        },
          h('div', { style: { ...btnStyle, background: 'var(--dsw-alias-bg-mask-2, rgba(0,0,0,0.45))', color: 'var(--dsw-alias-label-secondary, #aaa)', fontSize: 10 } }, status),
          h('button', { style: { ...btnStyle, padding: '6px 8px' }, onClick: () => setOpen((v) => !v), title: 'Rail Pulse 设置' }, '♪')
        ),
        open && h('div', { style: panelStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('div', { style: { fontWeight: 600, letterSpacing: 0.2 } }, 'Rail Pulse'),
            h('button', { style: { ...btnStyle, padding: '2px 7px', fontSize: 11 }, onClick: () => setOpen(false) }, '×')
          ),
          h('div', { style: { ...row, marginTop: 10 } },
            h('span', null, '显示律动条'),
            h('input', {
              type: 'checkbox', checked: !!cfg.visible,
              onChange: (e) => save({ visible: e.target.checked }),
              style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary, #8ab4ff)', cursor: 'pointer' }
            })
          ),
          h('div', { style: row },
            h('span', { style: label }, '灵敏度'),
            h('input', {
              type: 'range', min: 0.4, max: 2.4, step: 0.05, value: cfg.gain, style: slider,
              onChange: (e) => save({ gain: Number(e.target.value) })
            })
          ),
          h('div', { style: row },
            h('span', null, '自定义单色'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('input', {
                type: 'color', value: cfg.color || '#e8e8e8',
                onChange: (e) => save({ color: e.target.value, colorful: false }),
                style: { width: 28, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }
              }),
              h('span', { style: { ...label, minWidth: 54, textAlign: 'right' } }, (cfg.color || '#e8e8e8').toUpperCase())
            )
          ),
          h('div', { style: row },
            h('span', null, '炫彩色'),
            h('input', {
              type: 'checkbox', checked: !!cfg.colorful,
              onChange: (e) => save({ colorful: e.target.checked }),
              style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary, #8ab4ff)', cursor: 'pointer' }
            })
          ),
          h('div', { style: row },
            h('span', { style: label }, '平滑'),
            h('input', {
              type: 'range', min: 0.06, max: 0.7, step: 0.02, value: cfg.smoothing, style: slider,
              onChange: (e) => save({ smoothing: Number(e.target.value) })
            })
          ),
          h('div', { style: { ...label, marginTop: 6 } }, '选单色会自动关闭炫彩；跟随系统声音（ScreenCaptureKit），无需选择文件。')
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'rail-pulse', order: 200, label: 'Rail Pulse'
        }, RailPulse));
      }
    };
  }
});
