import * as THREE from 'three';

const FONT = '"JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';
const SANS = 'Inter, system-ui, "Segoe UI", Roboto, sans-serif';

/**
 * Crisp text label as a Sprite. The sprite is 1 unit tall in world space;
 * scale it with sprite.scale.set(h * aspect, h, 1) (aspect is in userData.aspect).
 */
export function makeTextSprite(text, opts = {}) {
  const {
    color = '#ffffff',
    bg = null,
    border = null,
    size = 64,
    mono = true,
    padX = 0.5,
    padY = 0.28,
    weight = 700,
    depthTest = false,
    opacity = 1
  } = opts;
  const font = `${weight} ${size}px ${mono ? FONT : SANS}`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const textW = Math.ceil(probe.measureText(text).width);
  const w = Math.ceil(textW + size * padX * 2);
  const h = Math.ceil(size * (1 + padY * 2));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    roundRect(ctx, 2, 2, w - 4, h - 4, h * 0.28);
    ctx.fill();
  }
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = Math.max(2, size * 0.04);
    roundRect(ctx, 2, 2, w - 4, h - 4, h * 0.28);
    ctx.stroke();
  }
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = size * 0.12;
  ctx.fillText(text, w / 2, h / 2 + size * 0.04);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest, depthWrite: false, opacity });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.aspect = w / h;
  sprite.renderOrder = 20;
  return sprite;
}

export function setSpriteHeight(sprite, height) {
  sprite.scale.set(height * (sprite.userData.aspect ?? 1), height, 1);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let glowTex;
/** Soft radial glow texture (cached). */
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
}
