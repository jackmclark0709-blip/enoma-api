// Shared client-side gate for internal admin-only pages (admin-list, sales-queue,
// voice, command-center). Confirms an active Supabase session belongs to the
// Enoma admin account and hands back its access token for calling JWT-gated
// api/ga-metrics.js actions. Requires the Supabase JS CDN script to already be
// loaded on the page before this file.
window.EnomaAdmin = (function () {
  const SUPABASE_URL = 'https://qhsivcenpnxwmvwznqie.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoc2l2Y2VucG54d212d3pucWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2ODQ4NjMsImV4cCI6MjA4MDI2MDg2M30.g_3eHoqfo7R15Q_9OoBy0DTq66a3BPA838VFd1aZtnc';
  const ADMIN_EMAIL = 'jack@enoma.io';

  let client = null;
  function getClient() {
    if (!client) client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  // Returns { accessToken, email, client } if the current session belongs to
  // the admin account, otherwise null. Callers show their own unauth UI.
  async function requireAdminSession() {
    const sb = getClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session || session.user.email !== ADMIN_EMAIL) return null;
    return { accessToken: session.access_token, email: session.user.email, client: sb };
  }

  return { ADMIN_EMAIL, getClient, requireAdminSession };
})();
