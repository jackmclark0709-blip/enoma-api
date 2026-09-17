// api/send-contact.js
// Handles contact form submissions from business profile pages, plus the
// early-funnel lead-capture sources (started_form, choose_path_concierge).
// Does TWO things: stores in DB + sends email to business owner.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Resend's constructor throws synchronously if the key is missing, which
// would crash this whole module (and every contact form on the site) at
// import time. Guard it the same way claim-business.js / generate-business.js
// do, so a missing key just skips email notifications instead of taking
// down lead capture entirely.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    name, email, phone, message, subject, business_id, to, slug, source,
    trade, town
  } = req.body;

  /* ─────────────────────────────────────────────
     SITE-WIDE FOOTER CTA — zero-friction, email only
     source === 'global_cta'
     Deliberately skips the name/message requirement
     below (that's the whole point — lowest possible
     barrier to entry). Lands in contact_submissions
     with business_id null, same as the other raw-lead
     sources, so it flows straight into the sales queue.
  ───────────────────────────────────────────── */
  if (source === 'global_cta') {
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    // insert() returns a thenable, not a real Promise — it has no .catch(),
    // so chaining one throws a TypeError on every call and crashes this
    // handler. Await it and check the returned error instead.
    const { error: globalCtaDbError } = await supabase.from('contact_submissions').insert({
      business_id: null,
      slug: null,
      name: 'Website visitor',
      email,
      phone: null,
      subject: 'Global CTA — wants Enoma to reach out',
      message: 'Submitted their email via the site-wide "Want us to reach out?" footer CTA — no other details provided.',
      source: 'global_cta',
      is_read: false,
    });
    if (globalCtaDbError) console.error('DB insert error:', globalCtaDbError.message);

    try {
      if (!resend) throw new Error('RESEND_API_KEY not configured');
      await resend.emails.send({
        from: 'Enoma <notifications@enoma.io>',
        to: 'jack@enoma.io',
        replyTo: email,
        subject: `🌱 New lead: someone wants a callback (footer CTA)`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0f172a;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:12px;font-weight:700;color:rgba(220,238,255,0.6);letter-spacing:0.1em;text-transform:uppercase;">Lead — Footer CTA</p>
              <p style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">${email}</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
              <p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6;">Left only their email via the site-wide footer CTA — no name, business, or message. Worth a quick personal reach-out.</p>
              <a href="mailto:${email}" style="display:inline-block;background:#16a34a;color:#fff;padding:11px 22px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;">Reach out →</a>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('global_cta notify email error:', err.message);
    }

    try {
      if (!resend) throw new Error('RESEND_API_KEY not configured');
      await resend.emails.send({
        from: 'Jack at Enoma <jack@enoma.io>',
        to: email,
        subject: `Thanks — we'll be in touch`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0f172a;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:22px;font-weight:800;color:#fff;">🌿 enoma</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
              <p style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 12px;">Thanks for reaching out!</p>
              <p style="font-size:14px;color:#374151;line-height:1.65;margin:0;">
                We got your email — I'll personally follow up shortly to see how Enoma can help your business grow.
                Questions in the meantime? Just reply to this email.<br><br>
                — Jack<br>
                <a href="https://enoma.io" style="color:#3882dc;">enoma.io</a>
              </p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('global_cta confirmation email error:', err.message);
    }

    return res.status(200).json({ ok: true });
  }

  /* ─────────────────────────────────────────────
     CONCIERGE REQUEST ("Have Jack build it for me")
     source === 'choose_path_concierge'
     The concierge card on choose-path.html only collects
     Trade + Phone (see the "no forms to fill out" pitch) —
     name/email are carried over from the earlier funnel
     step via query params, but are blank whenever someone
     lands on choose-path directly. Handled before the
     generic name/email/message check below, same as
     global_cta, so this doesn't require fields the form
     never asks for.
  ───────────────────────────────────────────── */
  if (source === 'choose_path_concierge') {
    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    const leadName = name || 'Website visitor';

    const { error: conciergeDbError } = await supabase.from('contact_submissions').insert({
      business_id: null,
      slug: null,
      name: leadName,
      email: email || null,
      phone,
      subject: subject || `New page request: ${leadName}`,
      message,
      source: 'choose_path_concierge',
      is_read: false,
    });
    if (conciergeDbError) console.error('DB insert error:', conciergeDbError.message);

    // Notify Jack
    try {
      if (!resend) throw new Error('RESEND_API_KEY not configured');
      await resend.emails.send({
        from: 'Enoma <notifications@enoma.io>',
        to: 'jack@enoma.io',
        replyTo: email || undefined,
        subject: `🌿 New page request: ${leadName}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0f172a;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:12px;font-weight:700;color:rgba(220,238,255,0.6);letter-spacing:0.1em;text-transform:uppercase;">New Page Request</p>
              <p style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">${leadName}</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;width:100px;vertical-align:top;">Business</td><td style="padding:7px 0;font-size:14px;font-weight:700;color:#0f172a;">${leadName}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Trade</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${trade || '—'}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Town</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${town || '—'}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Email</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${email ? `<a href="mailto:${email}" style="color:#3882dc;">${email}</a>` : '—'}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Phone</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${phone}</td></tr>
              </table>
              <a href="${email ? `mailto:${email}?subject=Your Enoma page is ready!` : `tel:${phone}`}" style="display:inline-block;background:#16a34a;color:#fff;padding:11px 22px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;margin-right:10px;">${email ? `Reply to ${leadName.split(' ')[0]} →` : `Call ${phone} →`}</a>
              <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Submitted via enoma.io/get-your-website → choose-path</p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('choose_path_concierge notify email error:', err.message);
    }

    // Confirm to the submitter (only if we have an email to send to)
    if (resend && email) try {
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
                We're building a free lead page for <strong>${leadName}</strong>. You'll get an email from me with the link within 1 business day.
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
      console.error('choose_path_concierge confirmation email error:', err.message);
    }

    return res.status(200).json({ ok: true });
  }

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email, and message are required' });
  }

  /* ─────────────────────────────────────────────
     3-FIELD "GET YOUR WEBSITE" FORM
     source === 'started_form'
     Fires the moment someone fills out the initial
     Business Name / Town / Email form, before they've
     picked a build path — lets Jack follow up on leads
     that don't make it through the rest of the funnel.
  ───────────────────────────────────────────── */
  if (source === 'started_form') {
    const { error: startedFormDbError } = await supabase.from('contact_submissions').insert({
      business_id: null,
      slug: null,
      name,
      email,
      phone: phone || null,
      subject: subject || `New lead: ${name}`,
      message,
      source: 'started_form',
      is_read: false,
    });
    if (startedFormDbError) console.error('DB insert error:', startedFormDbError.message);

    // Notify Jack — early-funnel lead, hasn't chosen a build path yet
    try {
      if (!resend) throw new Error('RESEND_API_KEY not configured');
      await resend.emails.send({
        from: 'Enoma <notifications@enoma.io>',
        to: 'jack@enoma.io',
        replyTo: email,
        subject: `🌱 New lead: ${name} started the signup form`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0f172a;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:12px;font-weight:700;color:rgba(220,238,255,0.6);letter-spacing:0.1em;text-transform:uppercase;">Lead — Form Started</p>
              <p style="margin:6px 0 0;font-size:22px;font-weight:800;color:#fff;">${name}</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:24px 28px;">
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;width:100px;vertical-align:top;">Business</td><td style="padding:7px 0;font-size:14px;font-weight:700;color:#0f172a;">${name}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Town</td><td style="padding:7px 0;font-size:14px;color:#0f172a;">${town || '—'}</td></tr>
                <tr><td style="padding:7px 0;font-size:13px;color:#7ab3e0;vertical-align:top;">Email</td><td style="padding:7px 0;font-size:14px;color:#0f172a;"><a href="mailto:${email}" style="color:#3882dc;">${email}</a></td></tr>
              </table>
              <p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6;">They haven't chosen a build path yet (self-serve or concierge). Worth a personal nudge if they don't finish on their own.</p>
              <a href="mailto:${email}" style="display:inline-block;background:#16a34a;color:#fff;padding:11px 22px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;">Reach out to ${name.split(' ')[0]} →</a>
              <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Submitted via enoma.io/get-your-website</p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('started_form notify email error:', err.message);
    }

    // Confirm to the submitter — point them to the next step
    try {
      if (!resend) throw new Error('RESEND_API_KEY not configured');
      const continueUrl = `https://enoma.io/choose-path?${new URLSearchParams({ name, city: town || '', email }).toString()}`;
      await resend.emails.send({
        from: 'Jack at Enoma <jack@enoma.io>',
        to: email,
        subject: `One more step to get ${name}'s page live`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
            <div style="background:#0f172a;padding:24px 28px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-size:22px;font-weight:800;color:#fff;">🌿 enoma</p>
            </div>
            <div style="background:#fff;border:1px solid #e4edf5;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
              <p style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 12px;">Thanks for starting your free page!</p>
              <p style="font-size:14px;color:#374151;line-height:1.65;margin:0 0 16px;">
                We've got <strong>${name}</strong> saved. Last step — choose how you'd like it built:
              </p>
              <ul style="font-size:14px;color:#374151;line-height:1.75;margin:0 0 20px;padding-left:20px;">
                <li><strong>Build it myself</strong> — our AI writes your page copy instantly, live in about 5 minutes.</li>
                <li><strong>Have Jack build it</strong> — tell us a bit more and we'll build it by hand, ready within 1 business day.</li>
              </ul>
              <a href="${continueUrl}" style="display:inline-block;background:#3882dc;color:#fff;padding:11px 22px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;">Pick up where you left off →</a>
              <p style="font-size:13px;color:#9ca3af;margin:20px 0 0;">Questions? Just reply to this email.<br>— Jack</p>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.error('started_form confirmation email error:', err.message);
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
  if (ownerEmail && resend) {
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
  if (resend) {
    try {
      await resend.emails.send({
        from: 'Enoma Platform <noreply@enoma.io>',
        to: 'jack@enoma.io',
        subject: `[Lead] ${name} contacted ${bName}`,
        html: `<p><b>${name}</b> (${email}) sent a message to <b>${bName}</b> via their Enoma page.</p><p>${message}</p>`,
      });
    } catch {}
  }

  return res.status(200).json({ ok: true });
}
