// Starts the app: finishes Microsoft sign-in if returning from it, then loads the data.
import { createRoot } from "react-dom/client";
import { AuthError, getAccessToken, handleRedirect, isSignedIn, signIn } from "./lib/auth";
import { FakeGraph } from "./lib/fakeGraph";
import { Graph, HttpGraph } from "./lib/graph";
import { SharePointStore } from "./lib/sharepoint";
import { App } from "./ui/App";
import { Brand } from "./ui/bits";
import { DataProvider } from "./ui/data";

declare const __DEMO__: boolean;

const root = createRoot(document.getElementById("root")!);

function SignInScreen({ message }: { message?: string }) {
  return (
    <>
      <header className="topbar"><Brand /></header>
      <div className="center">
        <div className="panel">
          <h1>Sign in</h1>
          <p style={{ margin: 0 }}>Use your Microsoft 365 work account. Your data stays in your SharePoint site.</p>
          {message && <p className="error-text" role="alert">{message}</p>}
          <div>
            <button type="button" className="btn primary" onClick={() => signIn("select_account")}>
              Sign in with Microsoft
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

async function start() {
  let graph: Graph;
  let user: string | undefined;

  if (__DEMO__) {
    graph = new FakeGraph("pp.demo");
    user = "Demo user";
  } else {
    try {
      await handleRedirect();
    } catch (e) {
      root.render(<SignInScreen message={e instanceof AuthError ? e.message : "Sign-in didn't complete."} />);
      return;
    }
    if (!isSignedIn()) {
      root.render(<SignInScreen />);
      return;
    }
    graph = new HttpGraph(getAccessToken);
    try {
      user = (await graph.get("/me?$select=displayName")).displayName;
    } catch {
      /* the data screens report connection problems themselves */
    }
  }

  root.render(
    <DataProvider store={new SharePointStore(graph)} user={user}>
      <App demo={__DEMO__} />
    </DataProvider>,
  );
}

start();
