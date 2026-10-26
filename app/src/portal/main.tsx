// The client portal's entry point: a separate page and bundle from the staff app, so none of the staff
// screens or code are ever sent to a client's browser.
import { createRoot } from "react-dom/client";
import { PortalApp } from "./PortalApp";
import { SignInScreen } from "./SignIn";
import { Config, handleRedirect, isSignedIn, takeNotice } from "./auth";
import { loadConfig } from "./api";

async function start() {
  const root = createRoot(document.getElementById("root")!);
  const cfg: Config | null = await loadConfig();
  if (!cfg) {
    root.render(<SignInScreen cfg={null} message="" />);
    return;
  }
  document.title = `${cfg.practiceName} client portal`;
  let message = takeNotice();
  const r = await handleRedirect(cfg);
  if (r === "failed") message = "Sign-in didn't complete. Please try again.";
  if (isSignedIn()) root.render(<PortalApp cfg={cfg} />);
  else root.render(<SignInScreen cfg={cfg} message={message} />);
}
void start();
