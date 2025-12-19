import express from "express";
import stripe from "./stripe.js";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

/* ----------------------------------------------------------
   PATH SETUP (ES MODULE SAFE __dirname)
---------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ----------------------------------------------------------
   SUPABASE CLIENT (SERVICE ROLE)
---------------------------------------------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();

/* ----------------------------------------------------------
   HEALTH CHECK
---------------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("Enoma backend is running!");
});

/* ----------------------------------------------------------
   STRIPE WEBHOOK (RAW BODY — MUST COME FIRST)
---------------------------------------------------------- */
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    console.log("➡️ Stripe webhook hit");

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).send("Webhook signature verification failed");
    }

    console.log(`✅ Event received: ${event.type}`);

    /* ------------------------------------------------------
       IDEMPOTENCY
    ------------------------------------------------------ */
    const eventId = event.id;

    const { data: existingEvent } = await supabase
      .from("stripe_events")
      .select("id")
      .eq("stripe_event_id", eventId)
      .single();

    if (existingEvent) {
      console.log("↩️ Event already processed:", eventId);
      return res.status(200).send("Already processed");
    }

    await supabase.from("stripe_events").insert({
      stripe_event_id: eventId,
      type: event.type
    });

    /* ------------------------------------------------------
       CHECKOUT COMPLETED
    ------------------------------------------------------ */
    if (event.type === "checkout.session.completed") {
      try {
        const session = event.data.object;

        const profileId = session.metadata?.profile_id;
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        if (!profileId) {
          console.warn("⚠️ No profile_id on checkout session");
          return res.status(200).send("No profile_id — skipped");
        }

        // 1. Fetch profile
        const { data: profile } = await supabase
          .from("small_business_profiles")
          .select("*")
          .eq("id", profileId)
          .single();

        if (!profile) {
          console.error("❌ Profile not found:", profileId);
          return res.status(400).send("Profile not found");
        }

        // 2. Create business
        const { data: business, error: businessError } = await supabase
          .from("businesses")
          .insert({
            name: profile.business_name || profile.name || "Enoma Business"
          })
          .select()
          .single();

        if (businessError) {
          console.error("❌ Business creation failed:", businessError.message);
          return res.status(500).send("Business creation failed");
        }

        // 3. Create subscription
        if (stripeSubscriptionId) {
          const { error: subError } = await supabase
            .from("subscriptions")
            .insert({
              business_id: business.id,
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: stripeSubscriptionId,
              status: "active"
            });

          if (subError) {
            console.error("❌ Subscription insert failed:", subError.message);
          }
        }

        // 4. Link profile → business
        const { error: linkError } = await supabase
          .from("small_business_profiles")
          .update({ business_id: business.id })
          .eq("id", profileId);

        if (linkError) {
          console.error("❌ Failed to link profile:", linkError.message);
        }

        console.log("✅ Checkout provisioning complete");
      } catch (err) {
        console.error("❌ Checkout handler error:", err);
        return res.status(500).send("Checkout handling failed");
      }
    }

    /* ------------------------------------------------------
       SUBSCRIPTION STATUS UPDATES
    ------------------------------------------------------ */
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      const sub = event.data.object;

      await supabase
        .from("small_business_profiles")
        .update({ subscription_status: sub.status })
        .eq("stripe_customer_id", sub.customer);

      console.log("🔄 Subscription status updated:", sub.status);
    }

    return res.status(200).send("OK");
  }
);

/* ----------------------------------------------------------
   JSON BODY PARSING (AFTER WEBHOOK)
---------------------------------------------------------- */
app.use(express.json());

/* ----------------------------------------------------------
   STATIC DASHBOARD (SERVES ../dashboard/index.html)
---------------------------------------------------------- */
app.use(
  "/dashboard",
  express.static(path.join(__dirname, "../dashboard"))
);

/* ----------------------------------------------------------
   BILLING SUCCESS PAGE
---------------------------------------------------------- */
app.get("/billing/success", (req, res) => {
  const { profile_id } = req.query;

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Successful</title>
        <meta charset="utf-8" />
        <script>
          setTimeout(() => {
            window.location.href = "/dashboard?profile_id=${profile_id}";
          }, 3000);
        </script>
      </head>
      <body style="font-family: system-ui; background:#f7f7fb; padding:40px;">
        <div style="max-width:600px;margin:auto;background:white;padding:32px;border-radius:12px;">
          <h1>🎉 Payment successful</h1>
          <p>Your subscription is now active.</p>
          <a href="/dashboard?profile_id=${profile_id}">
            Go to Dashboard →
          </a>
        </div>
      </body>
    </html>
  `);
});

/* ----------------------------------------------------------
   CREATE CHECKOUT SESSION
---------------------------------------------------------- */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { profile_id } = req.body;

    if (!profile_id) {
      return res.status(400).json({ error: "Missing profile_id" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL}/billing/success?profile_id=${profile_id}`,
      cancel_url: `${process.env.BASE_URL}/billing/cancelled`,
      metadata: { profile_id }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout session error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ----------------------------------------------------------
   SIMPLE TEST CHECKOUT
---------------------------------------------------------- */
app.get("/test-checkout", async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: "https://google.com",
    cancel_url: "https://google.com"
  });

  res.redirect(session.url);
});

/* ----------------------------------------------------------
   START SERVER
---------------------------------------------------------- */
app.listen(3000, () => {
  console.log("🚀 Enoma backend running on http://localhost:3000");
});
