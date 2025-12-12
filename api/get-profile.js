export default function handler(req, res) {
  const { slug, username } = req.query;

  return res.redirect(
    307,
    `/api/get-business?slug=${slug || username}`
  );
}


