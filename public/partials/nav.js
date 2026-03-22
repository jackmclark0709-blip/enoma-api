import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadNav() {
  try {
    const res = await fetch("/partials/nav.html");
    if (!res.ok) { console.error("Failed to load nav.html:", res.status); return; }

    const html = await res.text();
    document.body.insertAdjacentHTML("afterbegin", html);

    const links = document.getElementById("nav-links");
    if (!links) { console.error("nav-links not found"); return; }

    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.error("Session error:", error);

    if (session) {
      links.innerHTML = `
        <a href="/pricing">Pricing</a>
        <a href="/examples">Examples</a>
        <a href="/contact">Contact</a>
        <a href="/dashboard">Dashboard</a>
        <button id="logout-btn" class="btn-primary" style="font-size:0.85rem;padding:0.45rem 1.1rem;">Log out</button>
      `;
      document.getElementById("logout-btn")?.addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      });
    } else {
      links.innerHTML = `
        <a href="/pricing">Pricing</a>
        <a href="/examples">Examples</a>
        <a href="/contact">Contact</a>
        <a href="/login" class="site-nav__login">Sign in</a>
        <a href="/signup" class="btn-primary" style="font-size:0.85rem;padding:0.45rem 1.1rem;">Create my website</a>
      `;
    }

  } catch (err) {
    console.error("Nav failed to load:", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadNav);
} else {
  loadNav();
}
