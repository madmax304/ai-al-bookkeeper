/**
 * Plaid Link Server
 *
 * Run with: npm start
 * Then open http://localhost:3000 in your browser.
 *
 * This serves a simple UI where you:
 * 1. Enter a company name and account label
 * 2. Click "Connect Bank Account"
 * 3. Plaid Link opens → you authenticate → access token is stored locally
 *
 * In Sandbox mode, use these test credentials:
 *   Username: user_good
 *   Password: pass_good
 */
const express = require("express");
const path = require("path");
const { plaidClient } = require("./plaid-client");
const tokenStore = require("./token-store");
const { Products, CountryCode } = require("plaid");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Create a Link token (needed to initialize Plaid Link in the browser)
app.post("/api/create-link-token", async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: req.body.company || "default" },
      client_name: "Bookkeeper",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error("Error creating link token:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Exchange public token for access token (happens after user completes Link)
app.post("/api/exchange-token", async (req, res) => {
  try {
    const { public_token, company, label } = req.body;

    // Exchange the public token for a permanent access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const { access_token, item_id } = exchangeResponse.data;

    // Get account details
    const accountsResponse = await plaidClient.accountsGet({ access_token });
    const accounts = accountsResponse.data.accounts.map((a) => ({
      id: a.account_id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
    }));

    const institution_id = accountsResponse.data.item.institution_id;
    let institution_name = "Unknown";
    if (institution_id) {
      try {
        const instResponse = await plaidClient.institutionsGetById({
          institution_id,
          country_codes: [CountryCode.Us],
        });
        institution_name = instResponse.data.institution.name;
      } catch (e) {
        // Non-critical, continue
      }
    }

    // Store the token
    tokenStore.addAccount(company, label, {
      access_token,
      item_id,
      institution: institution_name,
      accounts,
    });

    res.json({
      success: true,
      institution: institution_name,
      accounts,
    });
  } catch (error) {
    console.error("Error exchanging token:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// List all linked accounts
app.get("/api/accounts", (req, res) => {
  res.json(tokenStore.getAllAccounts());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Bookkeeper - Plaid Link Server`);
  console.log(`  ================================`);
  console.log(`  Open http://localhost:${PORT} to connect bank accounts`);
  console.log(`  Environment: ${process.env.PLAID_ENV || "sandbox"}`);
  console.log(`\n  Sandbox credentials:`);
  console.log(`    Username: user_good`);
  console.log(`    Password: pass_good\n`);
});
