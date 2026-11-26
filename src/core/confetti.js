/**
 * Анимация праздничного салюта/конфетти на canvas при выборе места.
 */

export class ConfettiEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.rings = [];
    this.rafId = null;
    this.lastTime = 0;

    this._resize = this._resize.bind(this);
    this._tick = this._tick.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  _resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w;
    this.height = h;
  }

  burst(originX, originY, accentColor = '#F59E0B') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const palette = [
      accentColor,
      '#FBBF24',
      '#F8FAFC',
      '#F59E0B',
      '#38BDF8',
    ];

    const cx = originX ?? this.width / 2;
    const cy = originY ?? this.height / 2;

    this.rings.push({
      x: cx,
      y: cy,
      radius: 24,
      maxRadius: Math.min(this.width, this.height) * 0.42,
      alpha: 0.75,
      color: accentColor,
    });

    const count = 95;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
      const speed = 240 + Math.random() * 540;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 180,
        w: 6 + Math.random() * 7,
        h: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 14,
        color: palette[i % palette.length],
        alpha: 1,
        life: 0,
        maxLife: 1.5 + Math.random() * 0.9,
      });
    }

    if (!this.rafId) {
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this._tick);
    }
  }

  _tick(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.ctx.clearRect(0, 0, this.width, this.height);

    // Расходящиеся кольца
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.radius += (r.maxRadius - r.radius) * Math.min(1, dt * 6.5);
      r.alpha -= dt * 1.45;
      if (r.alpha <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      this.ctx.strokeStyle = r.color;
      this.ctx.globalAlpha = Math.max(0, r.alpha);
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
      this.ctx.restore();
    }

    // Конфетти-частицы
    const gravity = 820;
    const drag = 0.985;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= drag;
      p.vy = p.vy * drag + gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vRot * dt;

      const fadeStart = p.maxLife * 0.65;
      p.alpha = p.life > fadeStart ? 1 - (p.life - fadeStart) / (p.maxLife - fadeStart) : 1;

      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot);
      this.ctx.globalAlpha = Math.max(0, p.alpha);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      this.ctx.restore();
    }

    if (this.particles.length > 0 || this.rings.length > 0) {
      this.rafId = requestAnimationFrame(this._tick);
    } else {
      this.rafId = null;
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }
}
