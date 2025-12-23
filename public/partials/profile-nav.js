(async function () {
  const nav = document.createElement("div");
  document.body.prepend(nav);

  const res = await fetch("/partials/profile-nav.html");
  nav.innerHTML = await res.text();

  // Guard: profile must be loaded
  if (!window.profileData) return;

  const logo = document.getElementById("businessLogo");

  if (profileData.logo_url) {
    logo.src = profileData.logo_url;
    logo.alt = profileData.business_name || "Business logo";
    logo.style.display = "block";
  } else {
    logo.style.display = "none";
  }

    const cta = document.getElementById("profileCTA");
    cta.href = "#contact";
  }
})();
