export default function handler(req, res) {
  return res.json({
    urlExists: !!process.env.SUPABASE_URL,
    serviceExists: !!process.env.SUPABASE_SERVICE_KEY,
    urlLength: process.env.SUPABASE_URL?.length || 0,
    serviceLength: process.env.SUPABASE_SERVICE_KEY?.length || 0,
    node: process.version
  });
}

