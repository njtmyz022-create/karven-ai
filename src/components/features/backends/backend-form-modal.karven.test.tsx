import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("#/config/brand", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/config/brand")>();
  return { ...actual, IS_KARVEN_PRODUCT_BUILD: true };
});

vi.mock("./device-flow-auth", () => ({
  DeviceFlowAuth: () => null,
}));

import { BackendConnectionOptions } from "./backend-form-modal";

describe("Karven backend connection options", () => {
  it("requires the Karven Agent API key and omits upstream Cloud login", () => {
    render(<BackendConnectionOptions onConnected={vi.fn()} />);

    expect(screen.getByTestId("add-backend-api-key")).toBeRequired();
    expect(screen.getByTestId("add-backend-submit")).toBeDisabled();
    expect(screen.queryByTestId("add-backend-kind")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("add-backend-cloud-title"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("OpenHands Cloud")).not.toBeInTheDocument();
  });
});
