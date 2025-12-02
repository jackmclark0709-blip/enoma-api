export default function handler(req, res) {
  res.json({
    ok: true,
    envLoaded: !!process.env.SUPABASE_URL,
    hasKey: !!process.env.SUPABASE_ANON_KEY,
    timestamp: new Date().toISOString()
  });
}
