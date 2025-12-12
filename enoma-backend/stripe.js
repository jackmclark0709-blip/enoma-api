import dotenv from "dotenv";
dotenv.config(); // Load .env when this file is loaded

import Stripe from "stripe";

// Debug line — we should now see the real key, not undefined
console.log("Loaded Stripe Key in stripe.js:", process.env.STRIPE_SECRET_KEY);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default stripe;



