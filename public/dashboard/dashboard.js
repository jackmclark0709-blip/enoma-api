const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);




async function bootstrapDashboard() {
  // 1️⃣ Auth
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "/dashboard/login.html";
    return;
  }

  console.log("Logged in as:", session.user.email);

  // 2️⃣ Load ALL memberships
  const { data: memberships, error: memberError } = await supabase
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", session.user.id);

  if (memberError || !memberships?.length) {
    console.error("No business memberships found", memberError);
    return;
  }

  // 3️⃣ Load ALL profiles
  const businessIds = memberships.map(m => m.business_id);

  const { data: profiles, error: profileError } = await supabase
    .from("small_business_profiles")
    .select("business_id, username, business_name")
    .in("business_id", businessIds);

  if (profileError || !profiles?.length) {
    console.error("No profiles found", profileError);
    return;
  }

  // 4️⃣ Determine active business
  const params = new URLSearchParams(window.location.search);
  let activeBusinessId =
    params.get("business_id") || profiles[0].business_id;

  const activeProfile = profiles.find(
    p => p.business_id === activeBusinessId
  );

  if (!activeProfile) {
    console.error("Active profile not found");
    return;
  }

  // 5️⃣ Metrics loader
  async function loadMetrics(profile) {
    document.getElementById("business-name").textContent =
      profile.business_name || profile.username;

    const publicLink = document.getElementById("public-link");
    publicLink.href = `/p/${profile.username}`;
    publicLink.style.display = "inline-block";

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { count: pageViews } = await supabase
      .from("page_events")
      .select("*", { count: "exact", head: true })
      .eq("slug", profile.username)
      .eq("event", "page_view")
      .gte("created_at", since.toISOString());

    const { count: contactClicks } = await supabase
      .from("page_events")
      .select("*", { count: "exact", head: true })
      .eq("slug", profile.username)
      .eq("event", "contact_click")
      .gte("created_at", since.toISOString());

    document.getElementById("page-views").textContent = pageViews ?? 0;
    document.getElementById("contact-clicks").textContent = contactClicks ?? 0;

    // Traffic sources
    const { data: sources } = await supabase
      .from("page_events")
      .select("referrer")
      .eq("slug", profile.username)
      .eq("event", "page_view");

    const ul = document.getElementById("sources");
    ul.innerHTML = "";

    const totals = {};
    sources?.forEach(s => {
      const key = s.referrer || "direct";
      totals[key] = (totals[key] || 0) + 1;
    });

    Object.entries(totals).forEach(([source, visits]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${source}</span><strong>${visits}</strong>`;
      ul.appendChild(li);
    });
  }

  // 🚀 INITIAL LOAD
  await loadMetrics(activeProfile);

  // 6️⃣ Sign out
  document.getElementById("sign-out").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  });
}

bootstrapDashboard();
