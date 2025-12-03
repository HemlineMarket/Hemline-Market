// File: /api/shippo/purchase_label.js
// Buys a Shippo label for a specific rate and stores it in db_shipments.
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

import fetch from "node-fetch";
import supabaseAdmin from "../_supabaseAdmin";
import { rateLimit } from "../_rateLimit";
import { logError, logInfo } from "../_logger";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

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

    // 3) Return what the frontend needs
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
