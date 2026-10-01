// Inline SVG bar charts with confidence-interval whiskers. Geometry uses
// percentage coordinates so rows reflow at any width without a viewBox.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const pct = (v) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(2)}%`;

/**
 * rows: [{ label, value (0-1 or null), ci ([lo, hi] or null), muted, valueText, description }]
 * Appends one labelled row per entry plus an axis to `figure`.
 */
export function renderBarChart(figure, rows, { target = null } = {}) {
  figure.querySelectorAll('.viz-body').forEach((el) => el.remove());
  const body = document.createElement('div');
  body.className = 'viz-body';

  const H = 22;
  const barY = 4;
  const barH = 14;
  const mid = barY + barH / 2;

  for (const row of rows) {
    const wrap = document.createElement('div');
    wrap.className = 'viz-row';
    wrap.title = row.description;

    const label = document.createElement('div');
    label.className = 'viz-label';
    const name = document.createElement('span');
    name.textContent = row.label;
    const value = document.createElement('span');
    value.className = 'viz-value';
    value.textContent = row.valueText;
    label.append(name, value);

    const svg = svgEl('svg', { height: H, role: 'img', 'aria-label': row.description, focusable: 'false' });
    for (const g of [0.25, 0.5, 0.75]) {
      svg.append(svgEl('line', { x1: pct(g), x2: pct(g), y1: 0, y2: H, class: 'axis-line' }));
    }
    if (row.value != null) {
      const bar = svgEl('svg', { x: 0, y: 0, width: pct(row.value), height: H, overflow: 'visible' });
      const cls = row.muted ? 'bar-muted' : 'bar';
      bar.append(svgEl('rect', { x: 0, y: barY, width: '100%', height: barH, rx: 4, class: cls }));
      bar.append(svgEl('rect', { x: 0, y: barY, width: '50%', height: barH, class: cls }));
      svg.append(bar);
    }
    if (target != null) {
      svg.append(svgEl('line', { x1: pct(target), x2: pct(target), y1: 0, y2: H, class: 'target' }));
    }
    if (row.ci) {
      const [lo, hi] = row.ci;
      svg.append(svgEl('line', { x1: pct(lo), x2: pct(hi), y1: mid, y2: mid, class: 'whisker' }));
      svg.append(svgEl('line', { x1: pct(lo), x2: pct(lo), y1: mid - 6, y2: mid + 6, class: 'whisker' }));
      svg.append(svgEl('line', { x1: pct(hi), x2: pct(hi), y1: mid - 6, y2: mid + 6, class: 'whisker' }));
    }
    wrap.append(label, svg);
    body.append(wrap);
  }

  const axis = svgEl('svg', { height: 18, 'aria-hidden': 'true', focusable: 'false' });
  axis.append(svgEl('line', { x1: 0, x2: '100%', y1: 1, y2: 1, class: 'axis-line' }));
  const ticks = [[0, 'start'], [0.25, 'middle'], [0.5, 'middle'], [0.75, 'middle'], [1, 'end']];
  for (const [t, anchor] of ticks) {
    const text = svgEl('text', { x: pct(t), y: 15, 'text-anchor': anchor, class: 'axis-text' });
    text.textContent = `${Math.round(t * 100)}%`;
    axis.append(text);
  }
  body.append(axis);
  figure.append(body);
}
