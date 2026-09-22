import { describe, expect, it } from "vitest";
import type { AxiosAdapter } from "axios";
import { apiClient } from "@/lib/api/client";
import { billsApi } from "@/lib/api/bills";

/**
 * A bill must leave the browser as multipart/form-data.
 *
 * THE BUG THIS GUARDS AGAINST: the client sets a default Content-Type of
 * application/json. Axios's transformRequest turns FormData into a JSON object
 * when the content type says JSON (lib/defaults/index.js), so the file silently
 * vanished and the server answered 400 NO_FILE. The upload request must
 * therefore carry its own multipart content type.
 */
describe("billsApi.upload", () => {
  it("sends the file as multipart form data, not JSON", async () => {
    let captured: { data: unknown; contentType: string } | null = null;

    const original = apiClient.defaults.adapter;
    apiClient.defaults.adapter = (async (config) => {
      captured = {
        data: config.data,
        contentType: String(config.headers?.["Content-Type"] ?? ""),
      };
      return {
        data: { data: { bill: { id: "bill_1" } } },
        status: 201,
        statusText: "Created",
        headers: {},
        config,
      };
    }) as AxiosAdapter;

    try {
      const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "bill.pdf", {
        type: "application/pdf",
      });
      await billsApi.upload(file, "IN");
    } finally {
      apiClient.defaults.adapter = original;
    }

    expect(captured).not.toBeNull();
    const sent = captured!;

    // The give-away of the bug: data arrives as a JSON string instead.
    expect(typeof sent.data).not.toBe("string");
    expect(sent.data).toBeInstanceOf(FormData);
    expect(sent.contentType).toMatch(/multipart\/form-data/);

    const form = sent.data as FormData;
    expect(form.get("direction")).toBe("IN");
    expect(form.get("file")).toBeInstanceOf(File);
  });
});
