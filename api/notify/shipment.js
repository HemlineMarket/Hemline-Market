// File: /api/notify/shipment.js
// FIX: Added JWT/internal secret authentication
// Handles sending shipping updates (buyer + seller) via Postmark

import Postmark from "postmark";
import { createClient } from "@supabase/supabase-js";

const client = new Postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // FIX: Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      orderId,
      status,
      tracking_number,
      tracking_url,
      label_url,
      carrier,
      service,
      to_buyer,
      to_seller,
    } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    // Email subject line
    let subject = `Order ${orderId} — Update`;
    if (status === "LABEL_CREATED") subject = `Order ${orderId} — Label Created`;
    if (status === "IN_TRANSIT") subject = `Order ${orderId} — In Transit`;
    if (status === "DELIVERED") subject = `Order ${orderId} — Delivered`;

    // HTML + text bodies
    const htmlBody = `
      <h2>Order ${orderId} — ${status}</h2>
      <p>Carrier: ${carrier || "—"} · Service: ${service || "—"}</p>
      <p>Tracking: ${
        tracking_url
          ? `<a href="${tracking_url}" target="_blank">${tracking_number || "View Tracking"}</a>`
          : tracking_number || "Not available"
      }</p>
      <p>${
        label_url
          ? `<a href="${label_url}" target="_blank">Download Label (PDF)</a>`
          : ""
      }</p>
    `;

    const textBody = `
Order ${orderId} — ${status}
Carrier: ${carrier || "—"} · Service: ${service || "—"}
Tracking: ${tracking_url || tracking_number || "Not available"}
Label: ${label_url || ""}
`;

    // Send to buyer
    if (to_buyer) {
      await client.sendEmail({
        From: process.env.FROM_EMAIL,
        To: to_buyer,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: "outbound",
      });
    }

    // Send to seller
    if (to_seller) {
      await client.sendEmail({
        From: process.env.FROM_EMAIL,
        To: to_seller,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: "outbound",
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("notify/shipment error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
