(async function () {
  const footer = document.createElement("div");
  document.body.appendChild(footer);

  const res = await fetch("/partials/profile-footer.html");
  footer.innerHTML = await res.text();
})();
