function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export const env = {
  sessionSecret: required("SESSION_SECRET"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  jinaApiKey: optional("JINA_API_KEY"),
  voyageApiKey: optional("VOYAGE_API_KEY"),
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  googleMapsApiKey: optional("GOOGLE_MAPS_API_KEY"),
  googleWalletServiceAccountJson: optional("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"),
  googleWalletIssuerId: optional("GOOGLE_WALLET_ISSUER_ID"),
  isProduction: process.env.NODE_ENV === "production",
};
