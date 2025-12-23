(async function () {
  const navWrapper = document.createElement("div");
  document.body.prepend(navWrapper);

  const res = await fetch("/partials/profile-nav.html");
  navWrapper.innerHTML = await res.text();

  // Wait until profileData exists (max ~2s)
  let tries = 0;
  while (!window.profileData && tries < 20) {
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }

  const logo = document.getElementById("businessLogo");
  const cta = document.getElementById("profileCTA");

  if (!window.profileData) {
    console.warn("profileData not available for nav");
    return;
  }

  // ✅ Logo
  if (profileData.logo_url) {
    logo.src = profileData.logo_url;
    logo.alt = profileData.business_name || "Business logo";
    logo.style.display = "block";
  } else {
    logo.style.display = "none";
  }

  // ✅ CTA
  cta.href = "#contact";
})();

