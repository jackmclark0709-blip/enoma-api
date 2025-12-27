import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInRlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadNav() {
  // 1. Inject nav HTML
  const res = await fetch("/partials/nav.html");
  const html = await res.text();
  document.body.insertAdjacentHTML("afterbegin", html);

  const links = document.getElementById("nav-links");
  if (!links) return;

  // 2. Check auth session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 3. Render nav based on auth state
  if (session) {
    links.innerHTML = `
      <a href="/pricing">Pricing</a>
      <a href="/contact">Contact</a>
      <a href="/dashboard">Dashboard</a>
      <button id="logout-btn" class="nav-cta">Log out</button>
    `;

    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      });
    }

  } else {
    links.innerHTML = `
      <a href="/pricing">Pricing</a>
      <a href="/contact">Contact</a>
      <a href="/request" class="nav-cta">Request a Page</a>
    `;
  }
}

loadNav();
