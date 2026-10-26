// The client portal's entry point: a separate page and bundle from the staff app, so none of the staff
// screens or code are ever sent to a client's browser.
import { createRoot } from "react-dom/client";
import { PortalApp } from "./PortalApp";
import { SignInScreen } from "./SignIn";
import { Config, handleRedirect, isSignedIn, takeNotice } from "./auth";
import { loadConfig } from "./api";
import { applyBranding } from "./brand";
import { Preview } from "./Preview";

async function start() {
  const root = createRoot(document.getElementById("root")!);
  // The staff Branding screen frames this page to show a draft look. It never signs in or reads real data.
  if (new URLSearchParams(window.location.search).get("preview") === "1") {
    root.render(<Preview />);
    return;
  }
  const cfg: Config | null = await loadConfig();
  if (!cfg) {
    root.render(<SignInScreen cfg={null} message="" />);
    return;
  }
  document.title = `${cfg.practiceName} client portal`;
  applyBranding(cfg.branding);
  let message = takeNotice();
  const r = await handleRedirect(cfg);
  if (r === "failed") message = "Sign-in didn't complete. Please try again.";
  if (isSignedIn()) root.render(<PortalApp cfg={cfg} />);
  else root.render(<SignInScreen cfg={cfg} message={message} />);
}
void start();
