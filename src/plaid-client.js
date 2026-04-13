/**
 * Shared Plaid client configuration.
 * Used by both the Link server and the sync module.
 */
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
require("dotenv").config();

const envMap = {
  sandbox: PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development,
  production: PlaidEnvironments.production,
};

const plaidEnv = process.env.PLAID_ENV || "sandbox";
const plaidSecret =
  plaidEnv === "production"
    ? process.env.PLAID_SECRET_PRODUCTION
    : process.env.PLAID_SECRET_SANDBOX;

const configuration = new Configuration({
  basePath: envMap[plaidEnv] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": plaidSecret,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

module.exports = { plaidClient };
