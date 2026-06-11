// api/send-contact.js
// Handles contact form submissions from business profile pages.
// Also handles get_started intake form submissions (source=get_started).
// Does TWO things: stores in DB + sends email to business owner.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    name, email, phone, message, subject, business_id, to, slug, source,
    // get_started specific fields
    businessName, trade, town, facebookUrl, notes
  } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required' });
  }

  /* ─────────────────────────────────────────────
     GET STARTED INTAKE FORM
     source === 'get_started'
     Just notify Jack — no business profile lookup needed
  ───────────────────────────────────────────── */
  if (source === 'get_started') {
    // Store in contact_submissions for record
    await supabase.from('contact_submissions').insert({
      business_id: null,
      slug: null,
      name,
      email,
      phone: phone || null,
      subject: subject || `New page request: ${name}`,
      message,
      source: 'get_started',
      is_read: false,
    }).catch(err => console.error('DB insert error:', err.message));

    // Send rich notification to Jack
    try {
      await resend.emails.send({
        from: 'Enoma <notifications@enoma.io>',
        to: 'jack@enoma.io',
        replyTo: email,
        subject: `🌿 New page request: ${name}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0f172a;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:12px;font-weight:700;color:rgba(220,238,255,0.6);letter-spacing:0.1em;text-transform:uppercase;">New Page Request</p>
              <p style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">${name}</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;width:100px;vertical-align:top;">Business</td><td style="padding:7px 0;font-size:14px;font-weight:700;color:#0f172a;">${name}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Trade</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${trade || '—'}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Town</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${town || '—'}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Email</td><td style="padding:7px 0;font-size:14px;color:#0f172a;"><a href="mailto:${email}" style="color:#3882dc;">${email}</a></td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Phone</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${phone || '—'}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Facebook</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${facebookUrl ? `<a href="${facebookUrl}" style="color:#3882dc;">${facebookUrl}</a>` : '—'}</td></tr>
                ${notes ? `<tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Notes</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${notes}</td></tr>` : ''}
              </table>
              <a href="mailto:${email}?subject=Your Enoma page is ready!" style="display:inline-block;background:#16a34a;color:#fff;padding:11px 22px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;margin-right:10px;">Reply to ${name.split(' ')[0]} →</a>
              <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Submitted via enoma.io/get-started</p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('get_started email error:', err.message);
    }

    // Send confirmation to the submitter
    try {
      await resend.emails.send({
        from: 'Jack at Enoma <jack@enoma.io>',
        to: email,
        subject: `We got your request — page coming within 24 hours`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0f172a;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:22px;font-weight:800;color:#fff;">🌿 enoma</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
              <p style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 12px;">Hey, we got your request!</p>
              <p style="font-size:14px;color:#374151;line-height:1.65;margin:0 0 16px;">
                We're building a free lead page for <strong>${name}</strong>. You'll get an email from me with the link within 1 business day.
              </p>
              <p style="font-size:14px;color:#374151;line-height:1.65;margin:0 0 20px;">
                The page will have your services, your area, and a contact form so customers can reach you directly. It stays live free for 30 days — then it's $19.99/month to keep it running.
              </p>
              <p style="font-size:14px;color:#374151;margin:0;">
                Any questions? Just reply to this email.<br><br>
                — Jack<br>
                <a href="https://enoma.io" style="color:#3882dc;">enoma.io</a>
              </p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('get_started confirmation email error:', err.message);
    }

    return res.status(200).json({ ok: true });
  }

  /* ─────────────────────────────────────────────
     STANDARD CONTACT FORM (profile page leads)
  ───────────────────────────────────────────── */

  // ── 1. Look up the business to get owner email + business name ──
  let ownerEmail = to;
  let bName = 'your business';
  let resolvedBusinessId = business_id;
  let resolvedSlug = slug;

  if (business_id || slug) {
    const query = supabase
      .from('small_business_profiles')
      .select('email, business_name, business_id, username');

    const { data: profile } = business_id
      ? await query.eq('business_id', business_id).maybeSingle()
      : await query.eq('username', slug).maybeSingle();

    if (profile) {
      ownerEmail = profile.email || to;
      bName = profile.business_name || bName;
      resolvedBusinessId = profile.business_id;
      resolvedSlug = profile.username;
    }
  }

  // ── 2. Store in Supabase ──
  const { error: dbError } = await supabase
    .from('contact_submissions')
    .insert({
      business_id: resolvedBusinessId || null,
      slug: resolvedSlug || null,
      name,
      email,
      phone: phone || null,
      subject: subject || null,
      message,
      source: source || 'profile_page',
      is_read: false,
    });

  if (dbError) {
    console.error('DB insert error:', dbError.message);
  }

  // ── 3. Send email to business owner ──
  if (ownerEmail) {
    try {
      await resend.emails.send({
        from: 'Enoma <noreply@enoma.io>',
        to: ownerEmail,
        replyTo: email,
        subject: `New message from ${name} via your Enoma page`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0a1628;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:13px;font-weight:700;color:rgba(220,238,255,0.7);letter-spacing:0.1em;text-transform:uppercase;">New message</p>
              <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#fff;">${bName}</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;width:80px;">From</td><td style="padding:6px 0;font-size:13px;font-weight:600;color:#0a1628;">${name}</td></tr>
                <tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;">Email</td><td style="padding:6px 0;font-size:13px;color:#0a1628;"><a href="mailto:${email}" style="color:#3882dc;">${email}</a></td></tr>
                ${phone ? `<tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;">Phone</td><td style="padding:6px 0;font-size:13px;color:#0a1628;">${phone}</td></tr>` : ''}
                ${subject ? `<tr><td style="padding:6px 0;font-size:13px;color:#7ab3e0;">Topic</td><td style="padding:6px 0;font-size:13px;color:#0a1628;">${subject}</td></tr>` : ''}
              </table>
              <div style="background:#f7faff;border:1px solid #e4edf5;border-radius:10px;padding:16px 18px;margin-bottom:20px;">
                <p style="margin:0;font-size:14px;line-height:1.65;color:#374151;">${message.replace(/\n/g, '<br>')}</p>
              </div>
              <a href="mailto:${email}?subject=Re: Your enquiry to ${bName}" style="display:inline-block;background:#0a1628;color:#fff;padding:10px 20px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;">Reply to ${name} →</a>
              <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">This message was sent through your Enoma business page. <a href="https://enoma.io/dashboard" style="color:#7ab3e0;">View your dashboard →</a></p>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Email send error:', emailErr.message);
    }
  }

  // ── 4. Also notify Enoma (jack@enoma.io) for monitoring ──
  try {
    await resend.emails.send({
      from: 'Enoma Platform <noreply@enoma.io>',
      to: 'jack@enoma.io',
      subject: `[Lead] ${name} contacted ${bName}`,
      html: `<p><b>${name}</b> (${email}) sent a message to <b>${bName}</b> via their Enoma page.</p><p>${message}</p>`,
    });
  } catch {}

  return res.status(200).json({ ok: true });
}
