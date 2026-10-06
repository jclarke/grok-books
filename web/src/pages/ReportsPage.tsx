import { Link, useLocation } from "react-router-dom";
import { Card } from "../components/Card";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { useGlobalFilters, withGlobal } from "../hooks/useGlobalFilters";
import { formatRange } from "../lib/format";
import { businessLabel } from "../lib/labels";
import { reportList } from "../lib/reports";

export default function ReportsPage() {
  const filters = useGlobalFilters();
  const location = useLocation();
  return (
    <div className="page">
      <PageHeader title="Reports" subtitle={<>{formatRange(filters.start, filters.end)} · {businessLabel(filters.business)}. Every report prints cleanly and exports to CSV, XLSX, and PDF.</>} />
      <div className="report-grid">
        {reportList().map((report) => (
          <Card key={report.slug} as="article" className="report-card">
            <Link to={withGlobal(`/reports/${report.slug}`, location.search)} className="report-card__link">
              <span className="report-card__icon">
                <Icon name={report.icon} size={20} />
              </span>
              <span className="report-card__text">
                <span className="report-card__title">{report.title}</span>
                <span className="report-card__desc">{report.description}</span>
              </span>
              <Icon name="chevronRight" size={18} className="report-card__chev" />
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
