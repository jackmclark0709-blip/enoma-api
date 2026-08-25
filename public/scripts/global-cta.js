document.addEventListener("submit", async (e) => {
  const form = e.target.closest(".global-cta-form");
  if (!form) return;
  e.preventDefault();

  const input = form.querySelector('input[name="email"]');
  const button = form.querySelector('button[type="submit"]');
  const status = document.querySelector(".global-cta-status");
  const email = input.value.trim();
  if (!email) return;

  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Sending…";
  if (status) status.textContent = "";

  try {
    const res = await fetch("/api/send-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "global_cta" }),
    });
    if (!res.ok) throw new Error("request failed");
    form.reset();
    if (status) status.textContent = "Got it — we'll be in touch shortly.";
  } catch (err) {
    if (status) status.textContent = "Something went wrong — email jack@enoma.io directly instead.";
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});
