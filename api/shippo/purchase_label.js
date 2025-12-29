// File: /api/shippo/purchase_label.js
// Buys a Shippo label for a specific rate and stores it in db_shipments.
// Then automatically emails the seller with the label link.
//
// Expected POST body:
//   {
//     orderId: string,          // your internal order id
//     rateObjectId: string      // Shippo rate.object_id chosen by the user
//   }
//
// Env required:
//   SHIPPO_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   POSTMARK_SERVER_TOKEN

import fetch from "node-fetch";
import supabaseAdmin from "../_supabaseAdmin";
import { rateLimit } from "../_rateLimit";
import { logError, logInfo } from "../_logger";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

// Helper to send label-ready email to seller
async function sendLabelEmail(req, { sellerEmail, orderId, itemTitle, yards, totalCents, labelUrl, carrier }) {
  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
    const origin = `${proto}://${host}`;

    const resp = await fetch(`${origin}/api/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: sellerEmail,
        type: 'label_ready',
        data: {
          order_id: orderId,
          item_title: itemTitle,
          yards: yards,
          total_cents: totalCents,
          label_url: labelUrl,
          carrier: carrier,
          site_origin: origin,
        }
      })
    });

    if (!resp.ok) {
      await logError("/api/shippo/purchase_label", "Failed to send label email", { 
        sellerEmail, orderId, status: resp.status 
      });
    } else {
      await logInfo("/api/shippo/purchase_label", "Label email sent to seller", { 
        sellerEmail, orderId 
      });
    }
  } catch (emailErr) {
    await logError("/api/shippo/purchase_label", "Email send exception", { 
      message: emailErr?.message || emailErr 
    });
  }
}

export default async function handler(req, res) {
  // Simple per-IP rate limit
  if (!rateLimit(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { orderId, rateObjectId } = req.body || {};

    if (!orderId || !rateObjectId) {
      return res
        .status(400)
        .json({ error: "Missing orderId or rateObjectId" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    // 1) Buy the label for the chosen rate
    const txRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: rateObjectId,
        label_file_type: "PDF",
        async: false,
        metadata: `order:${orderId}`,
      }),
    });

    const tx = await txRes.json();

    if (!txRes.ok || tx.status !== "SUCCESS") {
      await logError(
        "/api/shippo/purchase_label",
        "Label purchase not successful",
        { orderId, rateObjectId, tx }
      );
      return res.status(502).json({
        error: "Label purchase not successful",
        details: tx,
      });
    }

    // 2) Persist to Supabase
    try {
      const payload = {
        order_id: orderId,
        shippo_transaction_id: tx.object_id || null,
        label_url: tx.label_url || null,
        tracking_number: tx.tracking_number || null,
        tracking_url: tx.tracking_url_provider || tx.tracking_url || null,
        carrier: tx.rate?.provider || null,
        service: tx.rate?.servicelevel?.name || null,
        amount_cents: tx.rate?.amount
          ? Math.round(parseFloat(tx.rate.amount) * 100)
          : null,
        status: "LABEL_PURCHASED",
        raw: tx,
      };

      // Remove any existing shipment row for this order so we don't have duplicates
      await supabaseAdmin.from("db_shipments").delete().eq("order_id", orderId);
      const { error } = await supabaseAdmin
        .from("db_shipments")
        .insert(payload);

      if (error) {
        await logError(
          "/api/shippo/purchase_label",
          "db_shipments insert error",
          { error, payload }
        );
      } else {
        await logInfo(
          "/api/shippo/purchase_label",
          "db_shipments upserted",
          { orderId, tracking_number: tx.tracking_number }
        );
      }
    } catch (dbErr) {
      await logError(
        "/api/shippo/purchase_label",
        "Unhandled DB error",
        { message: dbErr?.message || dbErr }
      );
    }

    // 3) Fetch order details and seller email to send notification
    try {
      const { data: order, error: orderErr } = await supabaseAdmin
        .from("orders")
        .select("id, seller_id, total_cents, items")
        .eq("id", orderId)
        .single();

      if (order && order.seller_id) {
        const { data: seller } = await supabaseAdmin
          .from("profiles")
          .select("email")
          .eq("id", order.seller_id)
          .single();

        // Also try auth.users if profile doesn't have email
        let sellerEmail = seller?.email;
        if (!sellerEmail) {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(order.seller_id);
          sellerEmail = authUser?.user?.email;
        }

        if (sellerEmail) {
          const items = order.items || [];
          const firstItem = items[0] || {};
          
          await sendLabelEmail(req, {
            sellerEmail,
            orderId,
            itemTitle: firstItem.name || firstItem.title || 'Your fabric',
            yards: firstItem.yards || firstItem.qty || '',
            totalCents: order.total_cents || 0,
            labelUrl: tx.label_url,
            carrier: tx.rate?.provider || 'USPS',
          });
        }
      }
    } catch (emailSetupErr) {
      // Don't fail the whole request if email fails
      await logError("/api/shippo/purchase_label", "Email setup error", { 
        message: emailSetupErr?.message || emailSetupErr 
      });
    }

    // 4) Return what the frontend needs
    return res.status(200).json({
      orderId,
      tracking_number: tx.tracking_number,
      tracking_url: tx.tracking_url_provider || tx.tracking_url || null,
      label_url: tx.label_url,
      carrier: tx.rate?.provider || null,
      service: tx.rate?.servicelevel?.name || null,
      rate: tx.rate || null,
    });
  } catch (err) {
    await logError("/api/shippo/purchase_label", "Unhandled error", {
      message: err?.message || err,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
