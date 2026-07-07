import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type BlockTemplateSeam = {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
  clipStart?: number;
  clipEnd?: number;
};

export type BlockTemplate = {
  id: number;
  createdByUserId: number | null;
  name: string;
  tags: string[];
  gridW: number;
  gridH: number;
  cells: string[];
  seams: BlockTemplateSeam[];
  blockSizeInches: number | null;
  seamAllowanceInches: number | null;
  thumbnailSvg: string | null;
  createdAt: string;
  updatedAt: string;
};

const BASE = "/api/quilting";
const QK = "block-templates";

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function useListBlockTemplates() {
  return useQuery<BlockTemplate[]>({
    queryKey: [QK],
    queryFn: () => apiFetch<BlockTemplate[]>("/block-templates"),
    staleTime: 1000 * 30,
  });
}

export function useGetBlockTemplate(id: number | null) {
  return useQuery<BlockTemplate>({
    queryKey: [QK, id],
    queryFn: () => apiFetch<BlockTemplate>(`/block-templates/${id}`),
    enabled: id !== null,
  });
}

type CreatePayload = {
  name: string;
  tags?: string[];
  gridW: number;
  gridH: number;
  cells: string[];
  seams?: BlockTemplateSeam[];
  blockSizeInches?: number | null;
  seamAllowanceInches?: number | null;
  thumbnailSvg?: string | null;
};

export function useCreateBlockTemplate() {
  const qc = useQueryClient();
  return useMutation<BlockTemplate, Error, CreatePayload>({
    mutationFn: (body) =>
      apiFetch<BlockTemplate>("/block-templates", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [QK] });
    },
  });
}

type PatchPayload = { id: number; name?: string; tags?: string[] };

export function usePatchBlockTemplate() {
  const qc = useQueryClient();
  return useMutation<BlockTemplate, Error, PatchPayload>({
    mutationFn: ({ id, ...rest }) =>
      apiFetch<BlockTemplate>(`/block-templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(rest),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useDeleteBlockTemplate() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch<void>(`/block-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [QK] });
    },
  });
}
