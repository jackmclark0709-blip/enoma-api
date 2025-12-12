import express from "express";
import stripe from "./stripe.js";
import { createClient } from "@supabase/supabase-js";

// ----------------------------------------------------------
// SUPABASE CLIENT (must use service role key)
// ----------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();

/**
 * ----------------------------------------------------------
 * HEALTH CHECK ROUTE — MUST COME BEFORE WEBHOOK
 * ----------------------------------------------------------
 */
app.get("/", (req, res) => {
  res.send("Enoma backend is running!");
});

/**
 * ----------------------------------------------------------
 * STRIPE WEBHOOK ROUTE — must use RAW body,
 * must come BEFORE express.json()
 * ----------------------------------------------------------
 */
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    console.log("➡️ Webhook route reached");

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
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`✅ Webhook received: ${event.type}`);

    // ----------------------------------------------------------
    // HANDLE CHECKOUT SESSION COMPLETED
    // ----------------------------------------------------------
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const email = session.customer_details?.email;
      const stripeCustomerId = session.customer;

      console.log("🔥 Checkout completed for:", email, stripeCustomerId);

      if (email && stripeCustomerId) {
        const { error } = await supabase
          .from("small_business_profiles")
          .update({
            stripe_customer_id: stripeCustomerId,
            subscription_status: "active",
          })
          .eq("email", email);

        if (error) {
          console.error("❌ Failed to update Supabase:", error.message);
        } else {
          console.log("✅ Supabase successfully updated for checkout.session.completed");
        }
      }
    }

    // ----------------------------------------------------------
    // HANDLE SUBSCRIPTION CREATED
    // ----------------------------------------------------------
    if (event.type === "customer.subscription.created") {
      const sub = event.data.object;

      const customerId = sub.customer;
      const status = sub.status;

      console.log("🔥 Subscription created:", status);

      const { error } = await supabase
        .from("small_business_profiles")
        .update({ subscription_status: status })
        .eq("stripe_customer_id", customerId);

      if (error) console.error("❌ Failed to update subscription:", error.message);
      else console.log("✅ Subscription status saved to Supabase");
    }

    // ----------------------------------------------------------
    // HANDLE SUBSCRIPTION UPDATED (renewal, paused, canceled, etc.)
    // ----------------------------------------------------------
    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;

      const customerId = sub.customer;
      const status = sub.status;

      console.log("🔥 Subscription updated:", status);

      const { error } = await supabase
        .from("small_business_profiles")
        .update({ subscription_status: status })
        .eq("stripe_customer_id", customerId);

      if (error) console.error("❌ Failed updating subscription:", error.message);
      else console.log("✅ Subscription updated in Supabase");
    }

    return res.status(200).send("OK");
  }
);

/**
 * ----------------------------------------------------------
 * AFTER webhook: enable JSON parsing
 * ----------------------------------------------------------
 */
app.use(express.json());

/**
 * ----------------------------------------------------------
 * CREATE CHECKOUT SESSION
 * ----------------------------------------------------------
 */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL}/billing/success`,
      cancel_url: `${process.env.BASE_URL}/billing/cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Error creating checkout session:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * ----------------------------------------------------------
 * SIMPLE TEST CHECKOUT
 * ----------------------------------------------------------
 */
app.get("/test-checkout", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: "https://google.com",
      cancel_url: "https://google.com",
    });

    res.redirect(session.url);
  } catch (err) {
    console.error("❌ Error in test checkout:", err.message);
    res.status(500).send("Error creating test checkout");
  }
});

/**
 * ----------------------------------------------------------
 * START SERVER
 * ----------------------------------------------------------
 */
app.listen(3000, () => {
  console.log("🚀 Enoma backend running on http://localhost:3000");
});

