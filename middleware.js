// middleware.js — Vercel Routing Middleware (runs before static files).
//
// Custom domains: when a paying customer's own domain (e.g. grilloplumbing.com)
// points at this project, its homepage must show THEIR page, not Enoma's
// marketing homepage (public/index.html). vercel.json rewrites can't do this
// because static files win over rewrites, so the host check lives here.
// api/p.js then resolves the business by small_business_profiles.custom_domain.
import { rewrite } from "@vercel/functions";

export const config = { matcher: "/" };

const ENOMA_HOSTS = /(^|\.)enoma\.io$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;

export default function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  if (!host || ENOMA_HOSTS.test(host)) return; // normal enoma.io homepage
  return rewrite(new URL("/api/p?custom_host=1", request.url));
}
