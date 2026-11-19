# Website v3 data contract

Shared data contract (A writes it, B and C read it).

```

small_business_profiles.fact_sheet  jsonb   -- built by A, rebuilt when reviews/owner answers/photos change
{
  version: 1, built_at,
  business: { name, trade, primary_type, google_types[], phone, address, town, state, hours[], rating, review_count, place_id },
  reviews: [ { id: "r1".."r5", author: "Russ B.", rating, text, relative_time } ],   // up to 5, all ratings >= 4, full text
  site_text: "" ,                                                                        // homepage text if they have a site
  owner: { names[], years_in_business, license_number, is_insured, offers_free_estimates, offers_emergency, blurb, service_for_page },
  towns: { home, confirmed[], suggested[] },
  photos: { owner[], work[], google_work_count }                                        // URLs only for owner uploads; Google photos stay live-only
}

small_business_profiles.page_copy_v3  jsonb   -- written by A's prompt, read by B's template
{
  eyebrow: "Plumber in North Attleborough, MA",          // built in code, not by the AI
  hero_headline: "...", hero_sub: "...",                 // each with evidence[]
  proof: [ { value: "4.6 ★", label: "22 Google reviews", evidence: ["g"] } ],   // 2-4 items; code builds rating/hours, AI may add review-backed ones
  services: [ { name, description, evidence[], stock_subject: "copper pipe repair close-up" } ],  // named by the homeowner's problem
  owner_section: { heading, body, evidence[] } | null,
  faqs: [ { q, a, evidence[] } ],
  closing: { heading, line },
  service_page: { service_name, slug, headline, intro, signs[], what_we_do[], review_ids[], faqs[], evidence[] } | null,
  removed: [ { field, text, reason } ]                   // what the checker took out, for Jack's review
}

```

Evidence ids: r1–r5 reviews, g Google listing, s site text, o.<field> owner answers. A claim with no evidence id isn't shown.
