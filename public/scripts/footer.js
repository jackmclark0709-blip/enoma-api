async function loadFooter() {
  const res = await fetch("/partials/footer.html");
  const html = await res.text();
  document.body.insertAdjacentHTML("beforeend", html);
}

loadFooter();
