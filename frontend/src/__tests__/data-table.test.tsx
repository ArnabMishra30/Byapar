import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable, Column } from "../components/shared/data-table";

interface TestItem {
  id: string;
  name: string;
  role: string;
}

const columns: Column<TestItem>[] = [
  { header: "Name", accessorKey: "name", sortable: true },
  { header: "Role", accessorKey: "role" },
];

const mockData: TestItem[] = [
  { id: "1", name: "Alice Admin", role: "ADMIN" },
  { id: "2", name: "Bob Staff", role: "STAFF" },
];

describe("DataTable Component", () => {
  it("renders table headers and row items", () => {
    render(<DataTable columns={columns} data={mockData} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
    expect(screen.getByText("Alice Admin")).toBeInTheDocument();
    expect(screen.getByText("Bob Staff")).toBeInTheDocument();
  });

  it("filters items using search box", () => {
    render(<DataTable columns={columns} data={mockData} />);
    const searchInput = screen.getByPlaceholderText("Search records...");

    fireEvent.change(searchInput, { target: { value: "Alice" } });
    expect(screen.getByText("Alice Admin")).toBeInTheDocument();
    expect(screen.queryByText("Bob Staff")).not.toBeInTheDocument();
  });

  it("shows empty state when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyTitle="No users found"
        emptyDescription="Please add users to continue."
      />
    );
    expect(screen.getByText("No users found")).toBeInTheDocument();
    expect(screen.getByText("Please add users to continue.")).toBeInTheDocument();
  });
});
