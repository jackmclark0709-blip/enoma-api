const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

/* --------------------------------------------------
   BOOTSTRAP (PROFILE-BASED ACCESS)
-------------------------------------------------- */
async function bootstrapDashboard() {
  const params = new URLSearchParams(window.location.search);
  const profileId = params.get("profile_id");

  if (!profileId) {
    console.warn("No profile_id provided — redirecting to login");
    window.location.href = "/login.html";
    return;
  }

  // 1. Resolve profile → business
  const { data: profile, error: profileError } = await supabaseClient
    .from("small_business_profiles")
    .select("business_id")
    .eq("id", profileId)
    .single();

  if (profileError || !profile?.business_id) {
    console.error("Failed to resolve business from profile:", profileError);
    document.getElementById("business-name").textContent =
      "Unable to load business";
    return;
  }

  loadDashboard(profile.business_id);
}

/* --------------------------------------------------
   DASHBOARD
-------------------------------------------------- */
async function loadDashboard(BUSINESS_ID) {
  console.log("Loading dashboard for business:", BUSINESS_ID);

  // 1. Load business
  const { data: business } = await supabaseClient
    .from("businesses")
    .select("*")
    .eq("id", BUSINESS_ID)
    .single();

  if (!business) {
    document.getElementById("business-name").textContent =
      "Business not found";
    return;
  }

  document.getElementById("business-name").textContent = business.name;
  document.getElementById("public-link").href = "/" + business.slug;

  // 2. Subscription
  const { data: subscription } = await supabaseClient
    .from("subscriptions")
    .select("*")
    .eq("business_id", BUSINESS_ID)
    .single();

  if (subscription) {
    document.getElementById("subscription-status").textContent =
      subscription.status;

    if (subscription.current_period_end) {
      document.getElementById("renewal-date").textContent =
        "Renews on " +
        new Date(subscription.current_period_end).toLocaleDateString();
    }
  }

  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  // 3. Metrics
  const { data: metrics } = await supabaseClient
    .from("daily_metrics")
    .select("*")
    .eq("business_id", BUSINESS_ID)
    .gte("day", since);

  if (metrics?.length) {
    document.getElementById("page-views").textContent =
      metrics.reduce((s, r) => s + (r.page_views || 0), 0);

    document.getElementById("contact-clicks").textContent =
      metrics.reduce((s, r) => s + (r.contact_clicks || 0), 0);
  }

  // 4. Sources
  const { data: sources } = await supabaseClient
    .from("top_sources_daily")
    .select("*")
    .eq("business_id", BUSINESS_ID)
    .gte("day", since);

  if (sources?.length) {
    const ul = document.getElementById("sources");
    ul.innerHTML = "";

    const totals = {};
    sources.forEach((s) => {
      totals[s.source] = (totals[s.source] || 0) + s.visits;
    });

    Object.entries(totals).forEach(([source, visits]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${source}</span><strong>${visits}</strong>`;
      ul.appendChild(li);
    });
  }

  // 5. Sign out (simple redirect for now)
  const signOutBtn = document.getElementById("sign-out");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", () => {
      window.location.href = "/login.html";
    });
  }
}

/* --------------------------------------------------
   START
-------------------------------------------------- */
bootstrapDashboard();


