// FILE: api/email/send.js
// FIX: Added JWT/internal secret authentication (BUG #18)
// Sends transactional emails via Postmark.
//
// CHANGE: Now requires valid JWT token OR internal secret
//
// ENV required: POSTMARK_SERVER_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// POST /api/email/send
// { "to": "buyer@email.com",
//   "type": "order_confirmation|shipping_update|delivered|refund_notice",
//   "data": { ... } }

import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function verifyAuth(req) {
  // Allow internal server-to-server calls
  const internalSecret = req.headers["x-internal-secret"];
  if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    return { internal: true };
  }

  // Verify JWT token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

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
      </tr>
    `;
  }).join('');
}

async function build(type, data = {}) {
  const site = data.site_origin || '';
  const support = data.support_url || `${site}/contact.html`;

  if (type === 'order_confirmation') {
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
      support_url: support,
      site_origin: site,
    });

    const subject = `Order received — ${data.order_id || 'Hemline Market'}`;
    const text = `Thanks! We received your order ${data.order_id || ''}.
Subtotal: ${fmtUSD(subtotal)}
Shipping: ${fmtUSD(shipping)}
Total: ${fmtUSD(total)}
Track & support: ${support}`;
    return { subject, html, text };
  }

  if (type === 'shipping_update') {
    const tpl = await loadTemplate('shipping-update');
    const html = render(tpl, {
      order_id: data.order_id || 'HM-000000',
      carrier: data.carrier || 'USPS',
      tracking: data.tracking || '—',
      track_url: data.track_url || '#',
      support_url: support,
      site_origin: site,
    });
    const subject = `Your order ${data.order_id || ''} is on the way ✂️📦`;
    const text = `Good news—your order ${data.order_id || ''} shipped!
Carrier: ${data.carrier || 'USPS'}
Tracking: ${data.tracking || ''}
Track it: ${data.track_url || ''}

Need help? ${support}`;
    return { subject, html, text };
  }

  if (type === 'delivered') {
    const tpl = await loadTemplate('delivered');
    const html = render(tpl, {
      order_id: data.order_id || 'HM-000000',
      support_url: support,
      site_origin: site,
    });
    const subject = `Delivered: Order ${data.order_id || ''} 🧵`;
    const text = `Your order ${data.order_id || ''} was delivered. 
Happy sewing! Need anything? ${support}`;
    return { subject, html, text };
  }

  if (type === 'refund_notice') {
    const tpl = await loadTemplate('refund-notice');
    const amt = fmtUSD(Number(data.amount_cents || 0));
    const html = render(tpl, {
      order_id: data.order_id || 'HM-000000',
      amount: amt,
      reason: data.reason || 'Refund issued',
      support_url: support,
      site_origin: site,
    });
    const subject = `Refund processed — ${amt} for ${data.order_id || 'your order'}`;
    const text = `We processed your refund of ${amt} for order ${data.order_id || ''}.
Reason: ${data.reason || 'Refund issued'}.
Questions? ${support}`;
    return { subject, html, text };
  }

  if (type === 'label_ready') {
    const tpl = await loadTemplate('label-ready');
    const html = render(tpl, {
      order_id: data.order_id || 'HM-000000',
      item_title: data.item_title || 'Your item',
      yards: data.yards || '',
      total: fmtUSD(Number(data.total_cents || 0)),
      label_url: data.label_url || '#',
      carrier: data.carrier || 'USPS',
      support_url: support,
      site_origin: site,
    });
    const subject = `Your shipping label is ready — ${data.order_id || 'Hemline Market'} 🏷️`;
    const text = `Your shipping label for order ${data.order_id || ''} is ready!

Item: ${data.item_title || 'Your item'}
Carrier: ${data.carrier || 'USPS'}

Print your label: ${data.label_url || ''}

Next steps:
1. Print the prepaid shipping label
2. Package your fabric carefully
3. Drop off at any ${data.carrier || 'USPS'} location

You'll receive payment 3 days after delivery confirmation.

Need help? ${support}`;
    return { subject, html, text };
  }

  throw new Error(`Unsupported email type: ${type}`);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // FIX: Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = process.env.POSTMARK_SERVER_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'POSTMARK_SERVER_TOKEN missing' });
    }

    const { to, type, data } = req.body || {};
    if (!to || !type) {
      return res.status(400).json({ error: 'Missing "to" or "type"' });
    }

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host  = (req.headers['x-forwarded-host']  || req.headers.host || '').toString();
    const origin = `${proto}://${host}`;

    const { subject, html, text } = await build(type, {
      ...(data || {}),
      site_origin: data?.site_origin || origin,
    });

    // From address: no-reply@<your-domain>
    const fromDomain = host.split(':')[0];
    const from = data?.from || `no-reply@${fromDomain}`;

    const resp = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': token,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        From: from,
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
