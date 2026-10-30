import { createContext, useContext } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

/** Pages rendered inside another page's header (e.g. the unit tabs) set this to 2 so only one h1 exists. */
export const PageHeaderLevelContext = createContext<1 | 2>(1);

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
}

export function PageHeader({ title, description, actions, breadcrumb }: PageHeaderProps) {
  const level = useContext(PageHeaderLevelContext);
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between")}>
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
              {breadcrumb.map((item, i) => {
                const last = i === breadcrumb.length - 1;
                return (
                  <li key={i} className="flex items-center gap-1.5">
                    {i > 0 && <ChevronRight className="h-[13px] w-[13px]" aria-hidden="true" />}
                    {item.href && !last ? (
                      <Link to={item.href} className="rounded-sm hover:text-foreground hover:underline">
                        {item.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? "page" : undefined} className={last ? "text-foreground" : undefined}>
                        {item.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <Heading className={level === 1 ? "text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em]" : "text-xl font-extrabold leading-tight tracking-tight"}>{title}</Heading>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
