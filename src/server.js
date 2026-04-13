/**
 * Plaid Link Server (single-company: natal)
 *
 * Run:  npm start
 * Then: http://localhost:3000
 *
 * Connect Chase and AMEX via Plaid Link. In production, both are
 * OAuth-required institutions — the PLAID_REDIRECT_URI env var must be
 * set and registered in the Plaid dashboard.
 *
 * Sandbox credentials: user_good / pass_good
 */
const express = require("express");
const path = require("path");
const { plaidClient } = require("./plaid-client");
const tokenStore = require("./token-store");
const { Products, CountryCode } = require("plaid");
require("dotenv").config();

const COMPANY = "natal";
const REDIRECT_URI = process.env.PLAID_REDIRECT_URI || null;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.post("/api/create-link-token", async (req, res) => {
  try {
    const request = {
      user: { client_user_id: COMPANY },
      client_name: "Natal Bookkeeper",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    };
    if (REDIRECT_URI) request.redirect_uri = REDIRECT_URI;

    const response = await plaidClient.linkTokenCreate(request);
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error("linkTokenCreate:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.post("/api/exchange-token", async (req, res) => {
  try {
    const { public_token, label } = req.body;
    if (!label) return res.status(400).json({ error: "label is required" });

    const exchange = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchange.data;

    const accountsRes = await plaidClient.accountsGet({ access_token });
    const accounts = accountsRes.data.accounts.map((a) => ({
      id: a.account_id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
    }));

    let institution = "Unknown";
    const institution_id = accountsRes.data.item.institution_id;
    if (institution_id) {
      try {
        const inst = await plaidClient.institutionsGetById({
          institution_id,
          country_codes: [CountryCode.Us],
        });
        institution = inst.data.institution.name;
      } catch (_) {}
    }

    tokenStore.addAccount(label, { access_token, item_id, institution, accounts });

    res.json({ success: true, institution, accounts });
  } catch (error) {
    console.error("exchangeToken:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.get("/api/accounts", (req, res) => {
  res.json(tokenStore.getAccounts());
});

// OAuth return — Plaid redirects here after the user authenticates with their
// bank. We serve the same SPA; the frontend detects oauth=1 and re-opens Link
// with receivedRedirectUri so it can complete the flow.
app.get("/oauth-return", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Natal Bookkeeper — Plaid Link`);
  console.log(`  ==============================`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Plaid env: ${process.env.PLAID_ENV || "sandbox"}`);
  console.log(`  Redirect URI: ${REDIRECT_URI || "(not set)"}`);
  console.log(`\n  Sandbox: user_good / pass_good\n`);
});
