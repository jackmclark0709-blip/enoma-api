import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qhsivcenpnxwmvwznqie.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadNav() {
  // 1. Inject HTML
  const res = await fetch("/partials/nav.html");
  const html = await res.text();
  document.body.insertAdjacentHTML("afterbegin", html);

  const links = document.getElementById("nav-links");

  // 2. Get session
  const { data: { session } } = await supabase.auth.getSession();

  // 3. Render links
  if (session) {
    links.innerHTML = `
      <a href="/dashboard">Dashboard</a>
      <a href="/create">Create page</a>
      <button id="logout-btn">Sign out</button>
    `;

    document
      .getElementById("logout-btn")
      .addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      });

  } else {
    links.innerHTML = `
      <a href="/login">Sign in</a>
      <a href="/signup" class="nav-cta">Get started</a>
    `;
  }
}

loadNav();
