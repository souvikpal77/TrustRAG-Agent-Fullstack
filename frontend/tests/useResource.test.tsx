import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDebounced, useResource } from "../src/hooks/useResource";

describe("useResource", () => {
  it("loads data and supports silent reloads", async () => {
    const loader = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() => useResource(loader));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 1 });
    expect(result.current.error).toBeNull();

    loader.mockResolvedValueOnce({ value: 2 });
    await act(async () => {
      await result.current.reload(true);
    });

    expect(result.current.data).toEqual({ value: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("captures loader failures as readable messages", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useResource(loader));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("does not call the loader when disabled", () => {
    const loader = vi.fn().mockResolvedValue("never");
    const { result } = renderHook(() => useResource(loader, [], { enabled: false }));

    expect(result.current.loading).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });
});

describe("useDebounced", () => {
  it("emits the latest value after the delay", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(
        ({ value }: { value: string }) => useDebounced(value, 300),
        { initialProps: { value: "a" } },
      );

      expect(result.current).toBe("a");

      rerender({ value: "b" });
      expect(result.current).toBe("a");

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current).toBe("b");
    } finally {
      vi.useRealTimers();
    }
  });
});
