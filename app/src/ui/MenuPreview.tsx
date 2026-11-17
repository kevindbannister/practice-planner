// The preview box on Settings, Appearance: the top bar, the white line under it and a small Work by type section, drawn with the
// app's own menu and classes so it looks the same as the real thing, with the draft choices applied to this box only. It is drawn at
// desktop width and scaled down to fit, and nothing in it can be clicked or reached with the keyboard.
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MenuKind, Mode, WORKSPACES, isModeKind, AREAS } from "../lib/navAreas";
import { PracticeLook, WorkViewChoice, lookVars } from "../lib/appearance";
import { bandsShown, emptyCounts } from "../lib/jobBands";
import { AreaMenu, AreaPicker, ModeMenu, TwoLineAreas, TwoLineModules } from "./AreaMenu";
import { WorkDisplay, type Item } from "./HomeWork";
import { Brand, Icon } from "./bits";
import { useData } from "./data";

const WIDTH = 1240;
const SECTION: Record<Mode, string> = { practice: "home", work: "work", advisory: "advisory-overview" };
const SAMPLE = [
  { overdue: 2, verySoon: 3, soon: 5, ok: 14, notYet: 4, hold: 0 },
  { overdue: 0, verySoon: 1, soon: 4, ok: 9, notYet: 0, hold: 0 },
  { overdue: 1, verySoon: 0, soon: 2, ok: 6, notYet: 6, hold: 0 },
];

export type PreviewTypes = { key: string; name: string; slot: number }[];

export function MenuPreview({ kind, look, layout, workView, types, mode }: {
  kind: MenuKind; look: PracticeLook; layout: "top" | "side"; workView: WorkViewChoice; types: PreviewTypes; mode: Mode;
}) {
  const { user } = useData();
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(300);
  useLayoutEffect(() => {
    const fit = () => {
      if (!box.current || !stage.current) return;
      const s = Math.min(1, box.current.clientWidth / WIDTH);
      setScale(s);
      setHeight(Math.ceil(stage.current.scrollHeight * s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    if (stage.current) ro.observe(stage.current);
    return () => ro.disconnect();
  }, []);
  // the box is a picture: links and buttons inside it are taken out of the tab order
  useEffect(() => { stage.current?.setAttribute("inert", ""); }, []);

  const toggle = isModeKind(kind);
  const shownMode: Mode = toggle ? mode : "practice";
  const section = SECTION[shownMode];
  const work = shownMode === "work";
  const advisory = shownMode === "advisory";
  const area = AREAS[0];
  const two = kind === "two";
  const vars = lookVars(look) as CSSProperties;
  const initials = (user || "You").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const items: Item[] = [
    { key: "ALL", name: "All work", total: true, c: sum(SAMPLE.slice(0, Math.max(1, types.length))), days: 30, ahead: "Next 30 days", onOpen: () => undefined },
    ...types.slice(0, 3).map((t, i) => ({ key: t.key, name: t.name, slot: t.slot, c: { ...SAMPLE[i % SAMPLE.length] }, days: 30, ahead: "Next 30 days", onOpen: () => undefined })),
  ];

  return (
    <div ref={box} className="ap-preview" style={{ height }} aria-hidden="true">
      <div ref={stage} className={`ap-stage${work || advisory ? " ap-work" : ""}`} style={{ ...vars, width: WIDTH, transform: `scale(${scale})` }}>
        <header className={`topbar${two ? " two" : ""}${toggle ? " mode-bar" : ""}${work || advisory ? " mode-work" : ""}${advisory ? " mode-advisory" : ""}`}>
          <div className="topbar-left">
            <Brand />
            <div className="hide-phone">
              {toggle ? <ModeMenu section={section} mode={shownMode} kind={kind} chase={3} />
                : two ? <TwoLineAreas section={section} area={area} onPick={() => undefined} />
                : kind === "pick" ? <AreaPicker section={section} area={area} onPick={() => undefined} chase={3} />
                : <AreaMenu section={section} rename={kind === "named"} chase={3} />}
            </div>
          </div>
          <div className="topbar-right">
            <div className="bar-actions"><div className="bar-actions-in">
              <span className="btn small"><Icon name="search" size={16} /> Search</span>
              <span className="btn small"><Icon name="spark" size={16} /> Ask</span>
              <span className="btn primary topbar-icon"><Icon name="plus" size={20} /></span>
            </div></div>
            <span className="ap-avatar">{initials || "?"}</span>
          </div>
          {two && <TwoLineModules section={section} area={area} chase={3} />}
        </header>

        {work ? (
          <div className="ap-line ap-line-work">
            <span className="paper-top-icon"><Icon name="briefcase" size={20} /></span>
            <strong className="wc-name">Example Trading Ltd</strong>
            <span className="chip mono">01234567</span>
            <span className="chip">Year end: 31 Mar</span>
            <span className="chip blue">Client page</span>
            <span className="ap-line-tools">
              {["Working papers", "Tax", "Payroll", "Co Sec", "Change client"].map((t) => <span key={t} className="btn small">{t}</span>)}
            </span>
          </div>
        ) : advisory ? (
          <div className="ap-line">
            <span className="page-tabs-name"><Icon name="chart" size={20} />{WORKSPACES.advisory.homeLabel}</span>
            <span className="ap-line-tools"><span className="btn small primary">Start a Freedom Plan</span><span className="btn small">Start a tax plan</span></span>
          </div>
        ) : (
          <div className="ap-line">
            <span className="page-tabs-name"><Icon name="home" size={20} />Home</span>
            {layout === "top" && (
              <span className="ap-tabs">
                {["Overview", "Today", "This week", "Chasing"].map((t, i) => <span key={t} className={i === 0 ? "on" : ""}>{t}</span>)}
              </span>
            )}
          </div>
        )}

        <div className={`ap-canvas${layout === "side" && !work && !advisory ? " ap-side" : ""}`}>
          {layout === "side" && !work && !advisory && (
            <div className="ap-sidelist">{["Overview", "Today", "This week", "Chasing"].map((t, i) => <span key={t} className={i === 0 ? "on" : ""}>{t}</span>)}</div>
          )}
          <section className="hw ap-hw">
            <div className="ap-hw-head"><h2>Work by type</h2></div>
            <WorkDisplay view={workView} items={items} bands={bandsShown(false)} />
          </section>
        </div>
      </div>
    </div>
  );
}

function sum(list: Record<string, number>[]) {
  const c = emptyCounts();
  for (const x of list) for (const k of Object.keys(c) as (keyof typeof c)[]) c[k] += x[k] || 0;
  return c;
}
