// Identifies the app and where its data lives. None of these values are secret:
// they only say which Microsoft 365 tenant and app registration to sign in with.

export const TENANT_ID = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
export const CLIENT_ID = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";

export const SITE_HOST = "insightinformation.sharepoint.com";
export const SITE_PATH = "/sites/PracticePlanner";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0`;

// Delegated permissions granted in the app registration.
export const SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Sites.ReadWrite.All",
  "Sites.Manage.All",
  "Files.ReadWrite",
];

// Planning defaults until the Settings list says otherwise.
export const DEFAULT_TIGHT_DAYS = 21;
export const DEFAULT_HOURS_PER_DAY = 7;
