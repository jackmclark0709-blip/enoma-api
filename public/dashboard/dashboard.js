const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";

const supabase = window.supabase.createClient(
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

  // 2️⃣ Resolve profile owned by this user
  const { data: profile, error } = await supabase
    .from("small_business_profiles")
    .select("username, business_name")
    .eq("auth_id", session.user.id)
    .single();

  if (error || !profile) {
    console.error("No profile found for user");
    return;
  }

  document.getElementById("business-name").textContent =
    profile.business_name || profile.username;

  // Public link
  const publicLink = document.getElementById("public-link");
  publicLink.href = `/p/${profile.username}`;
  publicLink.style.display = "inline-block";

  // 3️⃣ Metrics (last 30 days)
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

  // 4️⃣ Traffic sources
  const { data: sources } = await supabase
    .from("page_events")
    .select("referrer")
    .eq("slug", profile.username)
    .eq("event", "page_view");

  const ul = document.getElementById("sources");
  ul.innerHTML = "";

  const totals = {};
  sources?.forEach((s) => {
    const key = s.referrer || "direct";
    totals[key] = (totals[key] || 0) + 1;
  });

  Object.entries(totals).forEach(([source, visits]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${source}</span><strong>${visits}</strong>`;
    ul.appendChild(li);
  });

  // 5️⃣ Sign out
  document.getElementById("sign-out").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  });
}

bootstrapDashboard();


