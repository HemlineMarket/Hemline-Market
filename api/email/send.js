// Sends transactional emails via Postmark.
// ENV required: POSTMARK_SERVER_TOKEN
//
// POST /api/email/send
// { "to": "name@email.com", "type": "order_confirmation" | "label_ready", "data": { ... } }

import fs from 'node:fs/promises';
import path from 'node:path';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function fmtUSD(cents = 0) {
  const v = Math.max(0, Number(cents || 0)) / 100;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

async function loadTemplate(name) {
  // Templates live in /public/assets/emails
  const file = path.join(process.cwd(), 'public', 'assets', 'emails', `${name}.html`);
  return fs.readFile(file, 'utf8');
}

function render(template, map) {
  // very small moustache-style replace: {{key}}
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k) => {
    const v = map[k];
    return v == null ? '' : String(v);
  });
}

function itemsTable(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<tr><td style="padding:8px 0;color:#6b7280;">(No items)</td></tr>';
  }
  return items.map(it => {
    const name = it.name || 'Item';
    const qty  = Number(it.qty || 1);
    const cents = Number(it.amount || 0) * qty;
    return `
      <tr>
        <td style="padding:8px 0; font-size:14px; color:#111827;">
          ${name} <span style="color:#6b7280;">× ${qty}</span>
        </td>
        <td style="padding:8px 0 8px 16px; text-align:right; font-size:14px; color:#111827;">
          ${fmtUSD(cents)}
        </td>
      </tr>`;
  }).join('');
}

async function build(type, data = {}) {
  switch (type) {
    case 'order_confirmation': {
      const tpl = await loadTemplate('order-confirmation');

      const subtotal = Number(data.subtotal_cents || 0);
      const shipping = Number(data.shipping_cents || 0);
      const total    = subtotal + shipping;

      const html = render(tpl, {
        order_id: data.order_id || 'HM-000000',
        order_date: data.order_date || new Date().toLocaleDateString(),
        items_rows: itemsTable(data.items || []),
        subtotal: fmtUSD(subtotal),
        shipping: fmtUSD(shipping),
        total: fmtUSD(total),
        support_url: data.support_url || `${data.site_origin || ''}/contact.html`,
        site_origin: data.site_origin || '',
        preview: `We’ve got your order on the cutting table ✂️`,
      });

      const subject = `Order received — ${data.order_id || 'Hemline Market'}`;
      const text =
`Thanks! We received your order ${data.order_id || ''}.
Subtotal: ${fmtUSD(subtotal)}
Shipping: ${fmtUSD(shipping)}
Total: ${fmtUSD(total)}
View your orders: ${(data.site_origin || '')}/orders-buyer.html
Need help? ${data.support_url || `${data.site_origin || ''}/contact.html`}`;

      return { subject, html, text };
    }

    case 'label_ready': {
      // Sent to the **seller** when the label has been purchased/created.
      const tpl = await loadTemplate('label-ready');

      const html = render(tpl, {
        order_id: data.order_id || 'HM-000000',
        label_url: data.label_url || `${data.site_origin || ''}/dashboard.html`,
        site_origin: data.site_origin || '',
        preview: `Your Hemline shipping label is ready to print ✂️📦`,
      });

      const subject = `Your shipping label is ready — ${data.order_id || 'Hemline'}`;
      const text =
`Your Hemline shipping label is ready for order ${data.order_id || ''}.
Print your label: ${data.label_url || (data.site_origin ? data.site_origin + '/dashboard.html' : '')}`;

      return { subject, html, text };
    }

    default:
      throw new Error(`Unsupported email type: ${type}`);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const token = process.env.POSTMARK_SERVER_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'POSTMARK_SERVER_TOKEN missing' });
    }

    const { to, type, data } = req.body || {};
    if (!to || !type) {
      return res.status(400).json({ error: 'Missing "to" or "type"' });
    }

    const siteOrigin = data?.site_origin || `${(req.headers['x-forwarded-proto'] || 'https')}://${(req.headers['x-forwarded-host'] || req.headers.host)}`;
    const { subject, html, text } = await build(type, { ...(data || {}), site_origin: siteOrigin });

    // Send via Postmark
    const fromDomain = (new URL(siteOrigin)).hostname;
    const resp = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': token,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        From: data?.from || `no-reply@${fromDomain}`,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        MessageStream: 'outbound',
        TrackOpens: true,
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error('Postmark error:', errTxt);
      return res.status(502).json({ error: 'Email provider error' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('email/send error:', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
