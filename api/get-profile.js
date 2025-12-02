import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {

  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "No username provided" });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Profile not found" });
  }

  return res.json(data);
}
