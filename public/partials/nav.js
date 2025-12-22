import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadNav() {
  // 1. Inject nav HTML
  const res = await fetch("/partials/nav.html");
  const html = await res.text();
  document.body.insertAdjacentHTML("afterbegin", html);

  const links = document.getElementById("nav-links");

  // 2. Check auth session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 3. Render nav based on auth state
  if (session) {
    // ✅ Logged IN
    links.innerHTML = `
            <a href="https://marketing.enoma.io" target="_blank">About</a>
<a href="/dashboard">Dashboard</a>
      <a href="/create">Create page</a>
      <button id="logout-btn">Sign out</button>
      <a
        href="https://marketing.enoma.io/contact"
        class="nav-cta"
        target="_blank"
      >
        Get in touch
      </a>
    `;

    document
      .getElementById("logout-btn")
      .addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      });

  } else {
    // ❌ Logged OUT
    links.innerHTML = `
      <a href="https://marketing.enoma.io" target="_blank">About</a>
      <a href="/login">Sign in</a>
      <a
        href="https://marketing.enoma.io/contact"
        class="nav-cta"
        target="_blank"
      >
        Get in touch
      </a>
    `;
  }
}

loadNav();

