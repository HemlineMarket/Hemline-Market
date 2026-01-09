// public/js/eta-widget.js
// Hemline — Reusable ETA widget for product/checkout pages.
// Usage example to drop on ANY page (later, when you're ready):
// <div id="etaMount"
//      data-seller-id="UUID-OF-SELLER"
//      data-weight-oz="24"
//      data-handling-min="1"
//      data-handling-max="2"
//      data-length-in="12" data-width-in="9" data-height-in="2"></div>
// <script src="/js/eta-widget.js"></script>
// <script>EtaWidget.init({ mountId: 'etaMount' });</script>

(function() {
  function h(tag, attrs={}, children=[]) {
    const el = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function readNumber(el, attr, fallback=null) {
    const v = el.getAttribute(attr);
    if (v == null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw:text }; }
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  function fmtRange(startISO, endISO) { return `${startISO}–${endISO}`; }

  const EtaWidget = {
    init({ mountId }) {
      const mount = document.getElementById(mountId);
      if (!mount) return;

      // Required data attributes from the mount
      const seller_id = mount.getAttribute('data-seller-id');
      const weight_oz = readNumber(mount, 'data-weight-oz');
      const handling_min = readNumber(mount, 'data-handling-min');
      const handling_max = readNumber(mount, 'data-handling-max');
      const length_in = readNumber(mount, 'data-length-in', null);
      const width_in  = readNumber(mount, 'data-width-in',  null);
      const height_in = readNumber(mount, 'data-height-in', null);

      // Basic guard (don’t crash page if author forgot attrs)
      if (!seller_id || !weight_oz || handling_min == null || handling_max == null) {
        mount.textContent = '—';
        return;
      }

      // UI
      const wrapper = h('div', { class: 'eta-widget' , style:{fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, Arial'}});
      const row = h('div', { style:{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', alignItems:'end'}});
      const zipLab = h('label', { style:{fontSize:'12px', color:'#374151'}}, ['Destination ZIP']);
      const zip = h('input', { type:'text', placeholder:'ZIP', maxLength:'10',
        style:{padding:'8px', border:'1px solid #d1d5db', borderRadius:'8px', width:'100%'}});
      const btn = h('button', { type:'button', style:{padding:'10px 14px', border:'0', borderRadius:'8px', background:'#111', color:'#fff', cursor:'pointer'}}, ['Show ETA']);
      const line = h('div', { style:{marginTop:'10px', padding:'8px', border:'1px dashed #d1d5db', borderRadius:'8px', background:'#f9fafb', fontSize:'14px'}}, ['Ships ETA will appear here…']);
      const warn = h('div', { style:{color:'#b91c1c', marginTop:'6px', fontSize:'12px'}}, []);

      const left = h('div', {}, [zipLab, zip]);
      const right = h('div', {}, [btn]);
      row.appendChild(left); row.appendChild(right);
      wrapper.appendChild(row);
      wrapper.appendChild(line);
      wrapper.appendChild(warn);
      mount.innerHTML = '';
      mount.appendChild(wrapper);

      btn.addEventListener('click', async () => {
        warn.textContent = '';
        const zipVal = (zip.value || '').trim();
        if (!zipVal) { warn.textContent = 'Enter a destination ZIP'; return; }

        // Payload for ETA API — only ZIP is required for V1; assume US + infer city/state unknown
        const payload = {
          seller_id,
          to: { city: '—', state: '—', zip: zipVal, country: 'US' },
          parcel: { weight_oz, length_in: length_in ?? 0, width_in: width_in ?? 0, height_in: height_in ?? 0 },
          handling_days_min: handling_min,
          handling_days_max: handling_max
        };

        line.textContent = 'Calculating…';
        try {
          const data = await postJSON('/api/shipping/eta', payload);
          const { ships_in, arrives_by } = data;

          const shipsText = (ships_in.min === ships_in.max)
            ? `Ships in ${ships_in.min} business day${ships_in.min === 1 ? '' : 's'}`
            : `Ships in ${ships_in.min}–${ships_in.max} business days`;

          const etaText = arrives_by && arrives_by.start && arrives_by.end
            ? `Est. delivery ${fmtRange(arrives_by.start, arrives_by.end)}`
            : `Est. delivery window unavailable`;

          line.textContent = `${shipsText} · ${etaText}`;
        } catch (err) {
          warn.textContent = 'Error: ' + (err.message || String(err));
        }
      });
    }
  };

  window.EtaWidget = EtaWidget;
})();
