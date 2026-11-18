import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CandidateBadge,
  ModeBadge,
  RiskBadge,
  TLPBadge,
  TrustBadge,
  VerificationBadge,
} from "../src/components/badges";

describe("badges", () => {
  it("renders the TLP label", () => {
    render(<TLPBadge tlp="AMBER" />);
    expect(screen.getByText("AMBER")).toBeInTheDocument();
  });

  it("renders verification and candidate statuses", () => {
    render(
      <>
        <VerificationBadge status="SUPPORTED" />
        <CandidateBadge status="PENDING" />
      </>,
    );
    expect(screen.getByText("SUPPORTED")).toBeInTheDocument();
    expect(screen.getByText("PENDING")).toBeInTheDocument();
  });

  it("renders a trust band with its score", () => {
    render(<TrustBadge band="TRUSTED" score={82.45} />);
    expect(screen.getByText("TRUSTED")).toBeInTheDocument();
    expect(screen.getByText("82.5")).toBeInTheDocument();
  });

  it("renders evaluation mode and injection risk", () => {
    render(
      <>
        <ModeBadge mode="TRUSTRAG" />
        <RiskBadge risk="HIGH" />
      </>,
    );
    expect(screen.getByText("TrustRAG-Agent")).toBeInTheDocument();
    expect(screen.getByText("HIGH risk")).toBeInTheDocument();
  });
});
