import { exportUrl } from "../api/client";
import { Button } from "./Button";
import { Icon } from "./Icon";

type Params = Record<string, string | number | boolean | null | undefined>;

/** CSV / XLSX / PDF downloads from the Flask export endpoints, plus Print. */
export function ExportButtons({ base, params }: { base: string; params: Params }) {
  return (
    <div className="export-group" role="group" aria-label="Export">
      {(["csv", "xlsx", "pdf"] as const).map((ext) => (
        <a key={ext} className="btn btn--secondary btn--sm" href={exportUrl(`${base}.${ext}`, params)} download>
          <Icon name="download" size={15} /> {ext.toUpperCase()}
        </a>
      ))}
      <Button size="sm" icon="printer" onClick={() => window.print()}>
        <span className="hide-mobile">Print</span>
      </Button>
    </div>
  );
}
