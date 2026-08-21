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

  const alignClass = (align?: "left" | "right" | "center") =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

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
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                  onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "transition-colors duration-150",
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row)
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
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
