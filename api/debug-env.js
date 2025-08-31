// api/debug-env.js
module.exports = async (req, res) => {
  const key = process.env.RESEND_API_KEY || "";
  res.setHeader("Content-Type", "application/json");
  res.status(200).end(JSON.stringify({
    vercelEnv: process.env.VERCEL_ENV || null,          // "production" expected
    hasKey: key.length > 0,                             // should be true
    keyLength: key.length,                              // should be ~ 40+
    keyStartsWith: key.slice(0, 3)                      // should be "re_"
  }));
};
