// Settings, Appearance. Two parts:
// - Your view: the menu style, how Practice pages show their tabs, how Work by type is drawn, light or dark, and tips. Saved to your
//   account, so it follows you to any computer.
// - Practice look: the colours everyone sees. Only a partner or manager can change them (anyone, until people are set up).
// The preview on the right shows the choices before they are saved. Nothing changes in the app until Save is pressed.
import { useEffect, useMemo, useState } from "react";
import { ADVISORY_BARS, CANVASES, LOOK_KEY, PRACTICE_BARS, PracticeLook, Preset, SLOT_NAMES, WORK_BARS, WorkViewChoice } from "../lib/appearance";
import { MENU_KINDS, MenuKind, Mode, isModeKind } from "../lib/navAreas";
import { can } from "../lib/checklist";
import { builtInSlot, serviceSlot } from "../lib/serviceColour";
import { useMenuKind } from "./AreaMenu";
import { WORK_VIEWS } from "./HomeWork";
import { MenuPreview } from "./MenuPreview";
import { devicePersonal, usePracticeLook, useSavePersonal } from "./appearanceKit";
import { Icon } from "./bits";
import { useData } from "./data";
import { useStaff } from "./staffKit";
import { ThemeChoice } from "./theme";

type Mine = { kind: MenuKind; layout: "top" | "side"; workView: WorkViewChoice; theme: ThemeChoice; tips: boolean };

export function AppearanceSettings() {
  const { data, saveSetting } = useData();
  const staff = useStaff();
  const mayEdit = can(staff.cfg, staff.user, "template");
  const [kind, setKind] = useMenuKind();
  const savePersonal = useSavePersonal();
  const saved = usePracticeLook();

  const current = (): Mine => { const p = devicePersonal(); return { kind, layout: p.layout, workView: p.workView, theme: p.theme, tips: p.tips }; };
  const [mine, setMine] = useState<Mine>(current);
  const [look, setLook] = useState<PracticeLook>(saved);
  // once the account's menu style has loaded, or the saved look changes, start from them
  useEffect(() => { setMine((m) => ({ ...m, kind })); }, [kind]);
  useEffect(() => { setLook(saved); }, [saved]);
  const [mode, setMode] = useState<Mode>("practice");
  const [note, setNote] = useState("");
  const say = (t: string) => { setNote(t); window.setTimeout(() => setNote(""), 3000); };

  const services = useMemo(
    () => data.services.filter((s) => s.Key).map((s) => ({ key: String(s.Key), name: String(s.Title || s.Key) })).sort((a, b) => a.name.localeCompare(b.name)),
    [data.services],
  );
  const slotOf = (k: string) => look.serviceSlots[k] ?? serviceSlot(k);
  const previewTypes = services.filter((s) => slotOf(s.key) !== 0).concat(services.filter((s) => slotOf(s.key) === 0)).slice(0, 3).map((s) => ({ ...s, slot: slotOf(s.key) }));

  const mineChanged = JSON.stringify(mine) !== JSON.stringify(current());
  const lookChanged = JSON.stringify(look) !== JSON.stringify(saved);
  const set = <K extends keyof Mine>(k: K, v: Mine[K]) => setMine((m) => ({ ...m, [k]: v }));
  const setL = <K extends keyof PracticeLook>(k: K, v: PracticeLook[K]) => setLook((l) => ({ ...l, [k]: v }));
  const setSlot = (k: string, n: number) => setLook((l) => {
    const slots = { ...l.serviceSlots };
    if (n === builtInSlot(k)) delete slots[k]; else slots[k] = n;
    return { ...l, serviceSlots: slots };
  });

  const saveMine = async () => {
    if (mine.kind !== kind) setKind(mine.kind);
    await savePersonal({ layout: mine.layout, workView: mine.workView, theme: mine.theme, tips: mine.tips });
    say("Your view is saved");
  };
  const saveLook = async () => { await saveSetting(LOOK_KEY, look); say("The practice look is saved"); };

  return (
    <div className="ap">
      <div className="ap-options">
        <section className="card ap-card" aria-labelledby="ap-mine-h">
          <h2 id="ap-mine-h">Your view</h2>
          <p className="muted ap-lead">Just for you. It follows you to any computer you sign in on.</p>

          <fieldset className="ap-field">
            <legend>Menu style</legend>
            <div className="ap-choices">
              {MENU_KINDS.map(([k, label]) => (
                <label key={k} className={`ap-choice${mine.kind === k ? " on" : ""}`}>
                  <input type="radio" name="ap-kind" checked={mine.kind === k} onChange={() => set("kind", k)} /> {label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="ap-field">
            <legend>Practice pages</legend>
            <div className="ap-seg" role="radiogroup">
              {([["top", "Tabs on the page"], ["side", "List down the left"]] as const).map(([k, label]) => (
                <label key={k} className={mine.layout === k ? "on" : ""}><input type="radio" name="ap-layout" checked={mine.layout === k} onChange={() => set("layout", k)} />{label}</label>
              ))}
            </div>
          </fieldset>

          <fieldset className="ap-field">
            <legend>Work by type on Home</legend>
            <div className="ap-seg" role="radiogroup">
              {WORK_VIEWS.map(([k, label]) => (
                <label key={k} className={mine.workView === k ? "on" : ""}><input type="radio" name="ap-view" checked={mine.workView === k} onChange={() => set("workView", k)} />{label}</label>
              ))}
            </div>
          </fieldset>

          <fieldset className="ap-field">
            <legend>Light or dark</legend>
            <div className="ap-seg" role="radiogroup">
              {([["system", "Same as this computer"], ["light", "Light"], ["dark", "Dark"]] as const).map(([k, label]) => (
                <label key={k} className={mine.theme === k ? "on" : ""}><input type="radio" name="ap-theme" checked={mine.theme === k} onChange={() => set("theme", k)} />{label}</label>
              ))}
            </div>
          </fieldset>

          <label className="ap-check"><input type="checkbox" checked={mine.tips} onChange={(e) => set("tips", e.target.checked)} /> Show tips on each screen</label>

          <div className="ap-actions">
            <button type="button" className="btn primary" disabled={!mineChanged} onClick={saveMine}>Save my view</button>
            {mineChanged && <button type="button" className="btn" onClick={() => setMine(current())}>Undo changes</button>}
          </div>
        </section>

        <section className="card ap-card" aria-labelledby="ap-look-h">
          <h2 id="ap-look-h">Practice look</h2>
          <p className="muted ap-lead">
            {mayEdit ? "The colours everyone in the practice sees." : "The colours everyone in the practice sees. A partner or manager can change these."}
          </p>
          <fieldset className="ap-field" disabled={!mayEdit}>
            <legend>Work bar</legend>
            <Swatches name="ap-work" list={WORK_BARS} value={look.workBar} onPick={(v) => { setL("workBar", v); setMode("work"); }} />
          </fieldset>
          <fieldset className="ap-field" disabled={!mayEdit}>
            <legend>Advisory bar</legend>
            <Swatches name="ap-adv" list={ADVISORY_BARS} value={look.advisoryBar} onPick={(v) => { setL("advisoryBar", v); setMode("advisory"); }} />
          </fieldset>
          <fieldset className="ap-field" disabled={!mayEdit}>
            <legend>Practice bar</legend>
            <Swatches name="ap-prac" list={PRACTICE_BARS} value={look.practiceBar} wide onPick={(v) => { setL("practiceBar", v); setMode("practice"); }} />
          </fieldset>
          <fieldset className="ap-field" disabled={!mayEdit}>
            <legend>Page background</legend>
            <Swatches name="ap-canvas" list={CANVASES.map((c) => ({ key: c.key, label: c.label, value: `linear-gradient(90deg, ${c.practice} 50%, ${c.work} 50%)` }))} value={look.canvas} wide onPick={(v) => setL("canvas", v)} />
          </fieldset>
          <fieldset className="ap-field" disabled={!mayEdit}>
            <legend>Colour for each type of work</legend>
            <p className="muted ap-hint">Shown as a small dot beside the name. The name is always shown too, so the colour is only a quick guide.</p>
            {services.length === 0 ? <p className="muted">No types of work yet.</p> : (
              <ul className="ap-types">
                {services.map((s) => {
                  const n = slotOf(s.key);
                  return (
                    <li key={s.key}>
                      <span className="ap-type-name"><span className={`hw-mark svc-${n}`} aria-hidden="true" />{s.name}</span>
                      <span className="ap-dots" role="radiogroup" aria-label={`Colour for ${s.name}`}>
                        {SLOT_NAMES.map((label, i) => (
                          <label key={i} className={`ap-dot svc-${i}${n === i ? " on" : ""}`} title={label}>
                            <input type="radio" name={`ap-slot-${s.key}`} checked={n === i} onChange={() => setSlot(s.key, i)} aria-label={label} />
                          </label>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
          {mayEdit && (
            <div className="ap-actions">
              <button type="button" className="btn primary" disabled={!lookChanged} onClick={saveLook}>Save the practice look</button>
              {lookChanged && <button type="button" className="btn" onClick={() => setLook(saved)}>Undo changes</button>}
              <button type="button" className="btn" onClick={() => setLook({ workBar: "navy", advisoryBar: "purple", practiceBar: "gradient", canvas: "light", serviceSlots: {} })}>Back to the original colours</button>
            </div>
          )}
        </section>
      </div>

      <aside className="ap-side-col" aria-label="Preview">
        <div className="ap-sticky">
          <div className="ap-preview-head">
            <strong>Preview</strong>
            {isModeKind(mine.kind) && (
              <div className="ap-seg ap-modes" role="radiogroup" aria-label="Workspace to preview">
                {(["practice", "work", "advisory"] as Mode[]).map((m) => (
                  <label key={m} className={mode === m ? "on" : ""}><input type="radio" name="ap-mode" checked={mode === m} onChange={() => setMode(m)} />{m[0].toUpperCase() + m.slice(1)}</label>
                ))}
              </div>
            )}
          </div>
          <MenuPreview kind={mine.kind} look={look} layout={mine.layout} workView={mine.workView} types={previewTypes} mode={mode} />
          <p className="muted ap-hint">{mineChanged || lookChanged ? "Showing your changes. Save to use them." : "This is how the app looks now."}</p>
          {note && <p className="ap-saved" role="status"><Icon name="check" size={14} /> {note}</p>}
        </div>
      </aside>
    </div>
  );
}

function Swatches({ name, list, value, onPick, wide = false }: { name: string; list: Preset[]; value: string; onPick: (k: string) => void; wide?: boolean }) {
  return (
    <div className={`ap-swatches${wide ? " wide" : ""}`} role="radiogroup">
      {list.map((p) => (
        <label key={p.key} className={`ap-swatch${value === p.key ? " on" : ""}`}>
          <input type="radio" name={name} checked={value === p.key} onChange={() => onPick(p.key)} />
          <span className="ap-chip" style={{ background: p.value }} aria-hidden="true" />
          <span>{p.label}</span>
        </label>
      ))}
    </div>
  );
}
