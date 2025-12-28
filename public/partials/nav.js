import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInRlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


async function loadNav() {
  try {
    // Fetch nav partial
    const res = await fetch("/partials/nav.html");
    if (!res.ok) {
      console.error("Failed to load nav.html:", res.status);
      return;
    }

    const html = await res.text();

    // Inject nav at top of body
    document.body.insertAdjacentHTML("afterbegin", html);

    // Populate links
    const links = document.getElementById("nav-links");
    if (!links) {
      console.error("nav-links container not found");
      return;
    }

    links.innerHTML = `
      <a href="/pricing">Pricing</a>
      <a href="/contact">Contact</a>
      <a href="/request" class="nav-cta">Request a Page</a>
    `;
  } catch (err) {
    console.error("Error loading nav:", err);
  }
}

// Run after DOM is ready (extra safety)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadNav);
} else {
  loadNav();
}
