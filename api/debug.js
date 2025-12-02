export default function handler(req, res) {
  return res.json({
    urlExists: !!process.env.SUPABASE_URL,
    anonExists: !!process.env.SUPABASE_ANON_KEY,
    urlLength: process.env.SUPABASE_URL?.length || 0,
    anonLength: process.env.SUPABASE_ANON_KEY?.length || 0,
    node: process.version
  });
}
