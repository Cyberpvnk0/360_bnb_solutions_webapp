"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => number | string;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Fires with the row under the pointer, null on leave. */
  onRowHover?: (row: T | null) => void;
  /** Rendered instead of the body when rows is empty (and not loading). */
  emptyState?: React.ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  initialSort?: { key: string; dir: "asc" | "desc" };
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}

/**
 * ONE ROW, MEMOISED — which is the whole reason this table stays
 * usable at four hundred rows.
 *
 * Hovering a row tells the page which market is under the pointer, and
 * the page re-renders to light it on the map. Without this, that
 * re-render walked every row and every cell in the table — four hundred
 * rows of status chips and tooltips, each with state of its own —
 * between the pointer moving and anything happening. The lag was the
 * table rebuilding itself to change the background of one row.
 *
 * The props are all comparison-stable: `row` comes from a memoised
 * array, `columns` from a memo, `className` is the already-computed
 * string (so only the row whose class actually changed re-renders), and
 * the handlers are the stable wrappers below. Change any of those to an
 * inline value and the memo silently stops working.
 */
const Row = React.memo(function Row<T>({
  row,
  columns,
  className,
  clickable,
  onClick,
  onHover,
  alignClass,
}: {
  row: T;
  columns: DataTableColumn<T>[];
  className?: string;
  clickable: boolean;
  onClick: (row: T) => void;
  onHover: (row: T | null) => void;
  alignClass: (align?: "left" | "right" | "center") => string;
}) {
  return (
    <TableRow
      onClick={clickable ? () => onClick(row) : undefined}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHover(null)}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(row);
              }
            }
          : undefined
      }
      className={cn(
        "transition-colors duration-100",
        clickable && "cursor-pointer",
        className
      )}
    >
      {columns.map((col) => (
        <TableCell
          key={col.key}
          className={cn(
            "whitespace-nowrap py-2.5 tabular",
            alignClass(col.align),
            col.className
          )}
        >
          {col.cell(row)}
        </TableCell>
      ))}
    </TableRow>
  );
}) as <T>(props: {
  row: T;
  columns: DataTableColumn<T>[];
  className?: string;
  clickable: boolean;
  onClick: (row: T) => void;
  onHover: (row: T | null) => void;
  alignClass: (align?: "left" | "right" | "center") => string;
}) => React.ReactElement;

/** Stable for the life of the table: nothing about it varies. */
function alignClass(align?: "left" | "right" | "center"): string {
  return align === "right"
    ? "text-right"
    : align === "center"
      ? "text-center"
      : "text-left";
}

/**
 * Dense financial table: uppercase hairline header, tabular numerals,
 * hover state on every row, optional column sorting, built-in skeleton
 * and empty states. Numbers should be right-aligned via column.align.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  onRowHover,
  emptyState,
  loading = false,
  skeletonRows = 5,
  initialSort,
  rowClassName,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState(initialSort ?? null);

  /**
   * The callers' handlers, behind identities that never change.
   *
   * A page writes `onRowHover={(r) => setSelected(r?.slug)}` inline, as
   * it should, and that arrow is a new function every render — which
   * would break every row's memo on every render. The ref is refreshed
   * after each render and the wrappers below never change, so the rows
   * see one stable function for the life of the table.
   */
  const handlers = React.useRef({ onRowClick, onRowHover, rowClassName });
  React.useEffect(() => {
    handlers.current = { onRowClick, onRowHover, rowClassName };
  });
  const click = React.useCallback((row: T) => {
    handlers.current.onRowClick?.(row);
  }, []);
  const hover = React.useCallback((row: T | null) => {
    handlers.current.onRowHover?.(row);
  }, []);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  if (!loading && rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          {/* Tinted header band separates the table from the card body. */}
          <TableRow className="bg-secondary/60 hover:bg-secondary/60">
            {columns.map((col) => {
              const sortable = Boolean(col.sortValue);
              const active = sort?.key === col.key;
              return (
                <TableHead
                  key={col.key}
                  className={cn(
                    "h-9 whitespace-nowrap",
                    alignClass(col.align),
                    col.className
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((prev) =>
                          prev?.key === col.key
                            ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
                            : { key: col.key, dir: "desc" }
                        )
                      }
                      className={cn(
                        "metric-label inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground",
                        active && "text-foreground",
                        col.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {col.header}
                      {active ? (
                        sort?.dir === "asc" ? (
                          <ChevronUp aria-hidden className="size-3" />
                        ) : (
                          <ChevronDown aria-hidden className="size-3" />
                        )
                      ) : null}
                    </button>
                  ) : (
                    <span className="metric-label">{col.header}</span>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                  {columns.map((col) => (
                    <TableCell key={col.key} className="py-2.5">
                      <Skeleton
                        className={cn(
                          "h-3.5 w-full max-w-24",
                          col.align === "right" && "ml-auto"
                        )}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : sorted.map((row) => (
                <Row
                  key={rowKey(row)}
                  row={row}
                  columns={columns}
                  className={rowClassName?.(row)}
                  clickable={Boolean(onRowClick)}
                  onClick={click}
                  onHover={hover}
                  alignClass={alignClass}
                />
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
