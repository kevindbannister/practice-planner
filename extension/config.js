// Which Microsoft 365 tenant, app registration and SharePoint site the planner uses. None of these are secret (they are the same
// values the web app carries); they only say where to sign in and where the data lives.
export const TENANT_ID = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
export const CLIENT_ID = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
export const SITE_HOST = "insightinformation.sharepoint.com";
export const SITE_PATH = "/sites/PracticePlanner";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0`;
// Only what the extension needs: read and write the planner's lists, and know who is signed in.
export const SCOPES = ["openid", "profile", "offline_access", "User.Read", "Sites.ReadWrite.All"];
// The planner's lists, by their SharePoint display names.
export const LISTS = { clients: "PP Clients", jobs: "PP Jobs", services: "PP Services", time: "PP Job Time" };
