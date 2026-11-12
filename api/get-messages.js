// api/get-messages.js
// Returns recent contact submissions for a business.
// Used by the dashboard to show the "Messages" section.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Auth
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const { business_id } = req.query;
  if (!business_id) return res.status(400).json({ error: 'business_id required' });

  // Verify ownership
  const { data: membership } = await supabase
    .from('business_members')
    .select('role')
    .eq('business_id', business_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return res.status(403).json({ error: 'Not your business' });

  // Fetch messages — most recent 20, last 90 days
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const fetchMessages = cols => supabase
    .from('contact_submissions')
    .select(cols)
    .eq('business_id', business_id)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  const BASE_COLS = 'id, created_at, name, email, phone, subject, message, is_read, replied_at';
  // `answers` = the quote form's tap-to-choose answers (20261112_lead_answers.sql).
  // Until that migration has run, read the leads without it.
  let { data: messages, error } = await fetchMessages(`${BASE_COLS}, answers`);
  if (error && /answers/i.test(error.message || '')) ({ data: messages, error } = await fetchMessages(BASE_COLS));

  if (error) return res.status(500).json({ error: error.message });

  // Mark all as read
  const unreadIds = (messages || []).filter(m => !m.is_read).map(m => m.id);
  if (unreadIds.length) {
    await supabase
      .from('contact_submissions')
      .update({ is_read: true })
      .in('id', unreadIds);
  }

  // Return with unread count (before marking read)
  return res.status(200).json({
    messages: messages || [],
    unread_count: unreadIds.length,
  });
}
