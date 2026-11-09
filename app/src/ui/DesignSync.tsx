// Keeps the practice's saved document designs where every PDF maker can find them. Apart from the Document Designer screen so that
// this (mounted on every page) doesn't put the designer into the app's first download.
import { useEffect, useMemo } from "react";
import { readDesigns } from "../lib/docDesign";
import { useData } from "./data";
import { setDesigns } from "./docsKit";

/** Keeps the saved designs where every PDF maker can find them. */
export function DesignSync() {
  const { data } = useData();
  const saved = useMemo(() => readDesigns(data.settings), [data.settings]);
  useEffect(() => { setDesigns(saved); }, [saved]);
  return null;
}

