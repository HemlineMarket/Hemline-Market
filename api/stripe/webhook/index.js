// File: api/stripe/webhook/index.js
// ESM-only, self-contained Stripe webhook for Vercel.
// Saves order data including shipping address from Stripe checkout.
// AUTO-GENERATES shipping label via Shippo and emails it to seller (like Poshmark)

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Supabase (Admin/service role)
function getSupabaseAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url) {
    throw new Error(
      "Missing Supabase URL env var. Set SUPABASE_URL (preferred)."
    );
  }
  if (!serviceKey) {
    throw new Error(
      "Missing Supabase service role env var. Set SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getStripeSignatureHeader(req) {
  const h = req.headers?.["stripe-signature"];
  if (Array.isArray(h)) return h.join(",");
  return h ? String(h) : "";
}

// Shipping tier based on yards (matches checkout.html)
// <3yd = $5, 3-10yd = $8, >10yd = $15
function getShippingTier(shippingCents) {
  if (shippingCents <= 500) return "LIGHTWEIGHT";
  if (shippingCents <= 800) return "STANDARD";
  return "HEAVY";
}

// Estimate parcel size based on shipping tier
function getParcelForTier(tier) {
  switch (tier) {
    case "LIGHTWEIGHT":
      return { length: 10, width: 8, height: 1, weight: 0.5 };
    case "STANDARD":
      return { length: 12, width: 10, height: 3, weight: 2 };
    case "HEAVY":
      return { length: 14, width: 12, height: 5, weight: 5 };
    default:
      return { length: 12, width: 10, height: 3, weight: 2 };
  }
}

// Create shipping label via Shippo
async function createShippingLabel(orderData, sellerAddress, supabaseAdmin) {
  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  if (!SHIPPO_API_KEY) {
    console.warn("SHIPPO_API_KEY not set, skipping label creation");
    return null;
  }

  const tier = getShippingTier(orderData.shipping_cents || 0);
  const parcelSize = getParcelForTier(tier);

  const fromAddress = {
    name: sellerAddress.name || "Hemline Seller",
    street1: sellerAddress.street1 || "",
    street2: sellerAddress.street2 || "",
    city: sellerAddress.city || "",
    state: sellerAddress.state || "",
    zip: sellerAddress.zip || "",
    country: "US",
  };

  const toAddress = {
    name: orderData.shipping_name || "Customer",
    street1: orderData.shipping_address_line1 || "",
    street2: orderData.shipping_address_line2 || "",
    city: orderData.shipping_city || "",
    state: orderData.shipping_state || "",
    zip: orderData.shipping_postal_code || "",
    country: orderData.shipping_country || "US",
  };

  // Validate addresses
  if (!fromAddress.street1 || !fromAddress.city || !fromAddress.state || !fromAddress.zip) {
    console.warn("Seller address incomplete, skipping label creation");
    return null;
  }
  if (!toAddress.street1 || !toAddress.city || !toAddress.state || !toAddress.zip) {
    console.warn("Buyer address incomplete, skipping label creation");
    return null;
  }

  try {
    // 1. Create shipment to get rates
    const shipmentRes = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${SHIPPO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from: fromAddress,
        address_to: toAddress,
        parcels: [{
          length: parcelSize.length,
          width: parcelSize.width,
          height: parcelSize.height,
          distance_unit: "in",
          weight: parcelSize.weight,
          mass_unit: "lb",
        }],
        async: false,
      }),
    });

    const shipment = await shipmentRes.json();

    if (!shipmentRes.ok || !shipment.rates || shipment.rates.length === 0) {
      console.error("Shippo shipment error:", shipment);
      return null;
    }

    // 2. Pick the cheapest USPS rate (or first available)
    const uspsRates = shipment.rates.filter(r => r.provider === "USPS");
    const rates = uspsRates.length > 0 ? uspsRates : shipment.rates;
    const cheapestRate = rates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];

    // 3. Purchase the label
    const transactionRes = await fetch("https://api.goshippo.com/transactions/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${SHIPPO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rate: cheapestRate.object_id,
        label_file_type: "PDF",
        async: false,
      }),
    });

    const transaction = await transactionRes.json();

    if (!transactionRes.ok || transaction.status !== "SUCCESS") {
      console.error("Shippo transaction error:", transaction);
      return null;
    }

    // 4. Save to db_shipments
    const shipmentData = {
      order_id: orderData.id || orderData.stripe_checkout_session,
      shippo_transaction_id: transaction.object_id,
      label_url: transaction.label_url,
      tracking_number: transaction.tracking_number,
      tracking_url: transaction.tracking_url_provider || transaction.tracking_url,
      carrier: cheapestRate.provider,
      service: cheapestRate.servicelevel?.name || cheapestRate.servicelevel?.token,
      amount_cents: Math.round(parseFloat(cheapestRate.amount) * 100),
      status: "LABEL_CREATED",
      raw: transaction,
    };

    await supabaseAdmin.from("db_shipments").insert(shipmentData);

    return {
      label_url: transaction.label_url,
      tracking_number: transaction.tracking_number,
      tracking_url: transaction.tracking_url_provider || transaction.tracking_url,
      carrier: cheapestRate.provider,
      service: cheapestRate.servicelevel?.name,
    };

  } catch (err) {
    console.error("Shippo label creation error:", err);
    return null;
  }
}

// Send email with shipping label to seller via Postmark
async function emailLabelToSeller(sellerEmail, orderData, labelData, listingTitle) {
  const POSTMARK_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
  const FROM_EMAIL = process.env.FROM_EMAIL || "orders@hemlinemarket.com";

  if (!POSTMARK_TOKEN || !sellerEmail) {
    console.warn("Cannot send email: missing POSTMARK_TOKEN or seller email");
    return false;
  }

  const subject = `🎉 You made a sale! Print your shipping label`;
  
  const htmlBody = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #991b1b;">Congratulations! You made a sale! 🎉</h1>
      
      <p>Your item <strong>"${listingTitle || 'Fabric'}"</strong> just sold for <strong>$${((orderData.items_cents || 0) / 100).toFixed(2)}</strong>.</p>
      
      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h2 style="margin: 0 0 12px; color: #166534;">Your Prepaid Shipping Label</h2>
        <p style="margin: 0 0 8px;"><strong>Carrier:</strong> ${labelData.carrier || 'USPS'} ${labelData.service || ''}</p>
        <p style="margin: 0 0 8px;"><strong>Tracking:</strong> ${labelData.tracking_number || 'See label'}</p>
        <p style="margin: 0;">
          <a href="${labelData.label_url}" 
             style="display: inline-block; background: #991b1b; color: white; padding: 12px 24px; 
                    border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 12px;">
            📄 Download & Print Label (PDF)
          </a>
        </p>
      </div>
      
      <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px; color: #92400e;">Ship To:</h3>
        <p style="margin: 0; line-height: 1.6;">
          ${orderData.shipping_name || 'Customer'}<br>
          ${orderData.shipping_address_line1 || ''}${orderData.shipping_address_line2 ? '<br>' + orderData.shipping_address_line2 : ''}<br>
          ${orderData.shipping_city || ''}, ${orderData.shipping_state || ''} ${orderData.shipping_postal_code || ''}
        </p>
      </div>
      
      <h3>Next Steps:</h3>
      <ol style="line-height: 1.8;">
        <li>Print the shipping label (click the button above)</li>
        <li>Package your fabric securely</li>
        <li>Attach the label to your package</li>
        <li>Drop it off at any USPS location or schedule a pickup</li>
      </ol>
      
      ${labelData.tracking_url ? `
        <p><a href="${labelData.tracking_url}" style="color: #991b1b;">Track this shipment →</a></p>
      ` : ''}
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      
      <p style="color: #6b7280; font-size: 14px;">
        Questions? Reply to this email or visit <a href="https://hemlinemarket.com/contact.html" style="color: #991b1b;">Contact Us</a>.
      </p>
      
      <p style="color: #6b7280; font-size: 14px;">
        Happy selling!<br>
        <strong>The Hemline Market Team</strong>
      </p>
    </div>
  `;

  const textBody = `
Congratulations! You made a sale! 🎉

Your item "${listingTitle || 'Fabric'}" just sold for $${((orderData.items_cents || 0) / 100).toFixed(2)}.

YOUR PREPAID SHIPPING LABEL
Carrier: ${labelData.carrier || 'USPS'} ${labelData.service || ''}
Tracking: ${labelData.tracking_number || 'See label'}
Download Label: ${labelData.label_url}

SHIP TO:
${orderData.shipping_name || 'Customer'}
${orderData.shipping_address_line1 || ''}
${orderData.shipping_address_line2 ? orderData.shipping_address_line2 + '\n' : ''}${orderData.shipping_city || ''}, ${orderData.shipping_state || ''} ${orderData.shipping_postal_code || ''}

NEXT STEPS:
1. Print the shipping label
2. Package your fabric securely  
3. Attach the label to your package
4. Drop it off at any USPS location

${labelData.tracking_url ? 'Track shipment: ' + labelData.tracking_url : ''}

Questions? Visit https://hemlinemarket.com/contact.html

Happy selling!
The Hemline Market Team
  `;

  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": POSTMARK_TOKEN,
      },
      body: JSON.stringify({
        From: FROM_EMAIL,
        To: sellerEmail,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: "outbound",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Postmark error:", err);
      return false;
    }

    console.log("Label email sent to seller:", sellerEmail);
    return true;
  } catch (err) {
    console.error("Email send error:", err);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 1) Verify Stripe signature
  const sig = getStripeSignatureHeader(req);
  if (!sig) {
    return res
      .status(400)
      .send("Webhook signature error: Missing stripe-signature header");
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).send(`Raw body error: ${e?.message || e}`);
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  // 2) Only handle what you actually need
  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  // 3) Process order
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const session = event.data.object;
    const md = session.metadata || {};

    // Attempt to enrich listing data if we have listing_id
    let listingRow = null;
    if (md.listing_id) {
      const { data, error } = await supabaseAdmin
        .from("listings")
        .select("id, seller_id, title, image_url")
        .eq("id", md.listing_id)
        .maybeSingle();

      if (!error) listingRow = data;
    }

    const sellerId = md.seller_id || listingRow?.seller_id || null;
    const listingTitle = md.title || listingRow?.title || "";
    const listingImageUrl = md.image_url || listingRow?.image_url || null;

    const buyerEmail =
      session.customer_details?.email ||
      session.customer_email ||
      md.buyer_email ||
      null;

    const priceCents = Number(md.price_cents) || 0;
    const shippingCents = Number(md.shipping_cents) || 0;

    // Extract shipping address from Stripe session
    const shippingDetails = session.shipping_details || session.customer_details || {};
    const shippingAddress = shippingDetails.address || {};

    // Build order data object
    const orderData = {
      stripe_checkout_session: session.id,
      stripe_event_id: event.id,
      stripe_payment_intent: session.payment_intent || null,
      buyer_id: md.buyer_id || null,
      buyer_email: buyerEmail,
      seller_id: sellerId,
      listing_id: md.listing_id || null,
      items_cents: priceCents,
      shipping_cents: shippingCents,
      total_cents: priceCents + shippingCents,
      listing_title: listingTitle,
      listing_image_url: listingImageUrl,
      status: "PAID",
      // Shipping address fields
      shipping_name: shippingDetails.name || session.customer_details?.name || null,
      shipping_address_line1: shippingAddress.line1 || null,
      shipping_address_line2: shippingAddress.line2 || null,
      shipping_city: shippingAddress.city || null,
      shipping_state: shippingAddress.state || null,
      shipping_postal_code: shippingAddress.postal_code || null,
      shipping_country: shippingAddress.country || null,
    };

    // Insert order
    const { data: insertedOrder, error: insertError } = await supabaseAdmin
      .from("orders")
      .insert(orderData)
      .select()
      .single();

    // If order insert succeeded
    if (!insertError && insertedOrder) {
      // Mark listing sold if we have listing_id
      if (md.listing_id) {
        await supabaseAdmin
          .from("listings")
          .update({
            status: "SOLD",
            in_cart_by: null,
            reserved_until: null,
            sold_at: new Date().toISOString(),
          })
          .eq("id", md.listing_id);
      }

      // =====================================================
      // AUTO-GENERATE SHIPPING LABEL (Like Poshmark)
      // =====================================================
      let labelData = null;
      let sellerEmail = null;
      let sellerAddress = null;

      if (sellerId) {
        // Get seller's profile (email + address from user_metadata)
        const { data: sellerAuth } = await supabaseAdmin.auth.admin.getUserById(sellerId);
        
        if (sellerAuth?.user) {
          // Get email - prefer contact_email from profiles, fallback to auth email
          const { data: sellerProfile } = await supabaseAdmin
            .from("profiles")
            .select("first_name, last_name, contact_email")
            .eq("id", sellerId)
            .maybeSingle();

          sellerEmail = sellerProfile?.contact_email || sellerAuth.user.email;
          
          const meta = sellerAuth.user.user_metadata || {};
          const sellerName = [sellerProfile?.first_name, sellerProfile?.last_name]
            .filter(Boolean).join(" ") || meta.ship_name || "Hemline Seller";

          // Get seller's shipping address from user_metadata
          if (meta.ship_address1 && meta.ship_city && meta.ship_state && meta.ship_postal) {
            sellerAddress = {
              name: sellerName,
              street1: meta.ship_address1,
              street2: meta.ship_address2 || "",
              city: meta.ship_city,
              state: meta.ship_state,
              zip: meta.ship_postal,
            };
          }
        }

        // Create shipping label if we have seller address
        if (sellerAddress) {
          labelData = await createShippingLabel(
            { ...orderData, id: insertedOrder.id },
            sellerAddress,
            supabaseAdmin
          );

          // Update order with tracking info
          if (labelData) {
            await supabaseAdmin
              .from("orders")
              .update({
                tracking_number: labelData.tracking_number,
                tracking_url: labelData.tracking_url,
                label_url: labelData.label_url,
                shipping_carrier: labelData.carrier,
                shipping_service: labelData.service,
                shipping_status: "LABEL_CREATED",
              })
              .eq("id", insertedOrder.id);
          }
        }

        // Email the label to seller
        if (labelData && sellerEmail) {
          await emailLabelToSeller(sellerEmail, orderData, labelData, listingTitle);
        }

        // Create in-app notification for seller
        await supabaseAdmin
          .from("notifications")
          .insert({
            user_id: sellerId,
            type: "sale",
            kind: "sale",
            title: "You made a sale! 🎉",
            body: labelData 
              ? `Your item "${listingTitle || 'Fabric'}" sold! A shipping label has been emailed to you.`
              : `Your item "${listingTitle || 'Fabric'}" sold for $${(priceCents / 100).toFixed(2)}. Go to Sales to create a shipping label.`,
            href: "/sales.html",
            link: "/sales.html",
            listing_id: md.listing_id || null,
          });
      }

      // Notify buyer that their order was placed
      if (md.buyer_id) {
        await supabaseAdmin
          .from("notifications")
          .insert({
            user_id: md.buyer_id,
            type: "order",
            kind: "order",
            title: "Order confirmed!",
            body: `Your order for "${listingTitle || 'Fabric'}" has been placed. The seller will ship it soon.`,
            href: "/purchases.html",
            link: "/purchases.html",
            listing_id: md.listing_id || null,
          });
      }

      // Notify users who favorited this listing that it sold
      if (md.listing_id) {
        try {
          const { data: favorites } = await supabaseAdmin
            .from("favorites")
            .select("user_id")
            .eq("listing_id", md.listing_id);

          if (favorites && favorites.length > 0) {
            const notifications = favorites
              .filter(f => f.user_id !== md.buyer_id && f.user_id !== sellerId)
              .map(f => ({
                user_id: f.user_id,
                type: "favorite_sold",
                kind: "favorite_sold",
                title: "An item you favorited just sold",
                body: `"${listingTitle || 'A fabric'}" you saved is no longer available.`,
                href: "/favorites.html",
                link: "/favorites.html",
                listing_id: md.listing_id,
              }));

            if (notifications.length > 0) {
              await supabaseAdmin.from("notifications").insert(notifications);
            }
          }
        } catch (favErr) {
          console.warn("Could not notify favorite users:", favErr);
        }
      }
    }

    // If insert failed, surface it clearly (so Stripe retries, and you see why)
    if (insertError) {
      console.error("Webhook order insert failed:", insertError);
      return res.status(500).json({
        error: "Order insert failed",
        details: insertError,
      });
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).json({
      error: "Webhook handler error",
      message: e?.message || String(e),
    });
  }
}
