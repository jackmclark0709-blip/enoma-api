(async function () {
  const nav = document.createElement("div");
  document.body.prepend(nav);

  const res = await fetch("/partials/profile-nav.html");
  nav.innerHTML = await res.text();

  // Populate business-specific data
  if (window.profileData) {
    const logo = document.getElementById("businessLogo");
    if (profileData.logo_url) {
      logo.src = profileData.logo_url;
      logo.style.display = "block";
    } else {
      logo.style.display = "none";
    }

    const cta = document.getElementById("profileCTA");
    cta.href = "#contact";
  }
})();
