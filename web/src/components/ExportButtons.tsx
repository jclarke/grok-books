import { exportUrl } from "../api/client";
import { Button } from "./Button";
import { Icon } from "./Icon";

type Params = Record<string, string | number | boolean | null | undefined>;

/** CSV / XLSX / PDF downloads from the Flask export endpoints, plus Print (leave it off for a table inside a page). */
export function ExportButtons({ base, params, label, print = true }: { base: string; params: Params; label?: string; print?: boolean }) {
  return (
    <div className="export-group" role="group" aria-label={label ? `Export ${label}` : "Export"}>
      {(["csv", "xlsx", "pdf"] as const).map((ext) => (
        <a key={ext} className="btn btn--secondary btn--sm" href={exportUrl(`${base}.${ext}`, params)} download>
          <Icon name="download" size={15} /> {ext.toUpperCase()}
        </a>
      ))}
      {print ? (
        <Button size="sm" icon="printer" onClick={() => window.print()}>
          <span className="hide-mobile">Print</span>
        </Button>
      ) : null}
    </div>
  );
}
