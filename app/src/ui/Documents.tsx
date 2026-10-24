// Documents: letters and other documents made from templates in the practice's branding. Lives in
// the Comms area. Pages: Create, Templates (and the template editor), History, Branding.
import { CommsTabs } from "./commsKit";
import { BrandingScreen } from "./DocsBranding";
import { CreateDocument, DocumentHistory } from "./DocsCreate";
import { TemplateEditor, TemplateLibrary } from "./DocsTemplates";
import { useRoute } from "./bits";
import { useDocs } from "./docsKit";

const TABS: [string, string, string][] = [["", "Create", "#/comms/documents"], ["templates", "Templates", "#/comms/documents/templates"], ["history", "History", "#/comms/documents/history"], ["branding", "Branding", "#/comms/documents/branding"]];

export function DocumentsPage() {
  const { parts } = useRoute();
  const docs = useDocs();
  const sub = parts[2] === "new" ? "" : parts[2] === "template" ? "templates" : parts[2] || "";
  const titles: Record<string, string> = { "": "Create a document", templates: "Templates", history: "Document history", branding: "Branding" };
  return (
    <div className="page documents-page">
      <CommsTabs current="documents" />
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Letters and documents from templates, in your branding, as PDFs saved to the client.</p>
        </div>
      </div>
      <nav className="subtabs" aria-label="Documents">
        {TABS.map(([k, label, h]) => <a key={k} className="subtab" href={h} aria-current={sub === k ? "page" : undefined}>{label}</a>)}
      </nav>
      <h2 className="sr-only">{titles[sub]}</h2>
      {!docs.ready && <p className="import-list warn" role="alert">The document lists aren't set up yet. They are added automatically when the planner starts; if this stays, open Setup and choose “Create the lists”.</p>}
      {parts[2] === "template" && parts[3] ? <TemplateEditor key={parts[3]} id={decodeURIComponent(parts[3])} />
        : parts[2] === "templates" ? <TemplateLibrary />
        : parts[2] === "history" ? <DocumentHistory />
        : parts[2] === "branding" ? <BrandingScreen />
        : <CreateDocument />}
    </div>
  );
}
