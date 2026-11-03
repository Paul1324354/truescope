import { render, screen } from "@testing-library/react";
import { EventCard } from "@/components/EventCard";
import type { EventCard as Ev } from "@/lib/types";

vi.mock("next/link", () => ({ default: ({ children, href, ...p }: any) => <a href={href} {...p}>{children}</a> }));

const ev: Ev = {
  id: 1, title: "Testereignis", summary: "Zusammenfassung", image_url: null,
  event_date: new Date().toISOString(), last_updated_at: new Date().toISOString(),
  status: "DISPUTED", score: null, independent_sources: 3, article_count: 7, is_breaking: true,
  countries: [{ code: "AT", relation: "location" }, { code: "GB", relation: "source" }],
  categories: ["politik"], sources: [], manual_override: false, is_demo: true,
};

describe("EventCard", () => {
  it("shows status, independent sources, demo and breaking badges", () => {
    render(<EventCard ev={ev} />);
    expect(screen.getByText("DISPUTED")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/7 Berichte/)).toBeInTheDocument();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Breaking")).toBeInTheDocument();
    expect(screen.getByTitle(/Datenlage zu dünn/)).toBeInTheDocument();
  });
  it("shows the event country, not the source country", () => {
    render(<EventCard ev={ev} />);
    expect(screen.getByTitle("Betroffenes Land").textContent).toBe("🇦🇹");
  });
});
