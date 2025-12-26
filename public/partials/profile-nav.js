(async function () {
  const navWrapper = document.createElement("div");
  document.body.prepend(navWrapper);

  const res = await fetch("/partials/profile-nav.html");
  navWrapper.innerHTML = await res.text();

  function initProfileNav(profile) {
    if (!profile) return;

    const logo = document.getElementById("businessLogo");
    const cta = document.getElementById("profileCTA");

    // Logo
    if (profile.logo_url && logo) {
      logo.src = profile.logo_url;
      logo.alt = profile.business_name || "Business logo";
      logo.style.display = "block";
    } else if (logo) {
      logo.style.display = "none";
    }

    // CTA
    if (cta) {
if (
  (profile.primary_cta_type === "call" ||
   profile.primary_cta_type === "phone") &&
  profile.primary_cta_value
) {
        cta.href = `tel:${profile.primary_cta_value}`;
        cta.textContent = "Call";
      } else if (profile.primary_cta_type === "email" && profile.primary_cta_value) {
        cta.href = `mailto:${profile.primary_cta_value}`;
        cta.textContent = "Email";
      } else if (profile.primary_cta_type === "link" && profile.primary_cta_value) {
        cta.href = profile.primary_cta_value;
        cta.textContent = profile.primary_cta_label || "Contact";
      } else {
        cta.href = "#contact";
        cta.textContent = "Contact";
      }
    }

    console.log("✅ Profile nav initialized for:", profile.username);
  }

  // ✅ Initialize immediately if data already exists
  if (window.profileData) {
    initProfileNav(window.profileData);
  }

  // ✅ Otherwise wait for it
  window.addEventListener("profileDataReady", e => {
    initProfileNav(e.detail);
  });
})();


