import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

export default function NotFoundPage() {
  return (
    <div className="page">
      <PageHeader title="Page not found" />
      <EmptyState icon="search" title="There's no page at this address" action={<Link className="btn btn--primary btn--md" to="/">Go to the dashboard</Link>}>
        Use the sidebar, or press <kbd>Ctrl</kbd> <kbd>K</kbd> to search.
      </EmptyState>
    </div>
  );
}
