// File: /api/shippo/cancel_label.js
// Cancels a purchased Shippo label (if allowed by Shippo)
// Updates db_shipments.status to "CANCELLED"
//
// POST body:
//   { orderId: "xxxx" }
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
  if (!rateLimit(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { orderId } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    // 1) Look up the shipment in Supabase
    const { data: shipment, error: dbErr } = await supabaseAdmin
      .from("db_shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbErr) {
      await logError("/api/shippo/cancel_label", "db_shipments lookup error", dbErr);
      return res.status(500).json({ error: "Database error" });
    }

    if (!shipment) {
      return res.status(404).json({ error: "No shipment found for this order" });
    }

    if (!shipment.shippo_transaction_id) {
      return res
        .status(400)
        .json({ error: "Shipment has no Shippo transaction id to cancel" });
    }

    // If already cancelled, just return
    if (shipment.status === "CANCELLED") {
      return res.status(200).json({ ok: true, alreadyCancelled: true });
    }

    // 2) Call Shippo to cancel the transaction
    //    https://goshippo.com/docs/reference#transactions
    try {
      const cancelRes = await fetch(
        `https://api.goshippo.com/transactions/${shipment.shippo_transaction_id}/void/`,
        {
          method: "POST",
          headers: {
            Authorization: `ShippoToken ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const cancelData = await cancelRes.json();

      if (!cancelRes.ok) {
        await logError("/api/shippo/cancel_label", "Shippo cancel error", cancelData);
        return res.status(400).json({
          error: "Shippo cancel error",
          details: cancelData,
        });
      }

      // Shippo returns "SUCCESS" or possible errors depending on carrier rules.
      // If the carrier doesn't allow void after a certain time, we surface that.
      if (cancelData.status && cancelData.status.toUpperCase() !== "SUCCESS") {
        await logError(
          "/api/shippo/cancel_label",
          "Shippo cancel not successful",
          cancelData
        );
        return res.status(400).json({
          error: "Label could not be cancelled with carrier",
          details: cancelData,
        });
      }

      // 3) Mark shipment as cancelled in Supabase
      const { error: updErr } = await supabaseAdmin
        .from("db_shipments")
        .update({
          status: "CANCELLED",
          cancelled_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);

      if (updErr) {
        await logError(
          "/api/shippo/cancel_label",
          "db_shipments update error",
          updErr
        );
      } else {
        await logInfo("/api/shippo/cancel_label", "Shipment cancelled", {
          orderId,
          shippo_transaction_id: shipment.shippo_transaction_id,
        });
      }

      return res.status(200).json({
        ok: true,
        orderId,
        shippo_transaction_id: shipment.shippo_transaction_id,
        shippo_response: cancelData,
      });
    } catch (shippoErr) {
      await logError("/api/shippo/cancel_label", "Shippo cancel exception", {
        message: shippoErr?.message || shippoErr,
      });
      return res.status(500).json({ error: "Shippo cancel failed" });
    }
  } catch (err) {
    await logError("/api/shippo/cancel_label", "Unhandled error", {
      message: err?.message || err,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
