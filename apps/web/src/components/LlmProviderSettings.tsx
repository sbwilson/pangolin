import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  type ApiError,
  assignLlmPurpose,
  createLlmProvider,
  deleteLlmProvider,
  fetchLlmRequestPreview,
  fetchLlmSettings,
  type LlmProviderKind,
  type LlmProviderSafeView,
  type LlmPurpose,
  testLlmProvider,
  updateLlmProvider,
} from "../api.ts";
import { ReauthDialog } from "./ReauthDialog.tsx";
import { Button } from "./ui/button.tsx";

export const LLM_SETTINGS_KEY = ["llm", "settings"] as const;
export const LLM_PREVIEW_KEY = ["llm", "preview"] as const;

const PURPOSE_LABELS: Record<LlmPurpose, { title: string; description: string }> = {
  categorise: {
    title: "Transaction categorisation",
    description: "Suggests payees, categories, and confidence scores for imported transactions.",
  },
  pdf_extract: {
    title: "PDF statement extraction",
    description:
      "Extracts transactions from statement PDFs. Blocked on cloud providers unless opted in.",
  },
  row_interpret: {
    title: "Set-aside row interpretation",
    description:
      "Interprets unparsed raw bank rows in Needs review. Never sends private account rows.",
  },
};

export function LlmProviderSettings() {
  const queryClient = useQueryClient();

  // Queries
  const settingsQuery = useQuery({
    queryKey: LLM_SETTINGS_KEY,
    queryFn: fetchLlmSettings,
    retry: false,
  });

  const previewQuery = useQuery({
    queryKey: LLM_PREVIEW_KEY,
    queryFn: () => fetchLlmRequestPreview({ purpose: "categorise" }),
    retry: false,
  });

  // UI state
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProviderSafeView | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testResults, setTestResults] = useState<
    Record<
      string,
      {
        ok: boolean;
        latencyMs?: number | undefined;
        error?: string | undefined;
        loading?: boolean | undefined;
      }
    >
  >({});
  const [actionError, setActionError] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formKind, setFormKind] = useState<LlmProviderKind>("openai");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formCloudPdf, setFormCloudPdf] = useState(false);
  const [formCloudRows, setFormCloudRows] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Re-authentication state
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  const isLocalUrl = (urlStr: string): boolean => {
    try {
      const u = urlStr.includes("://") ? new URL(urlStr) : new URL(`http://${urlStr}`);
      const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      return (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "local" ||
        host.endsWith(".local") ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      );
    } catch {
      return false;
    }
  };
  const isLocalPreview = formBaseUrl.trim().length > 0 && isLocalUrl(formBaseUrl.trim());

  const providers = settingsQuery.data?.providers ?? [];
  const assignments = settingsQuery.data?.assignments ?? [];

  const assignmentMap = new Map<LlmPurpose, string>();
  for (const a of assignments) {
    assignmentMap.set(a.purpose, a.providerId);
  }

  const resetForm = () => {
    setFormName("");
    setFormKind("openai");
    setFormBaseUrl("");
    setFormModel("");
    setFormApiKey("");
    setFormCloudPdf(false);
    setFormCloudRows(false);
    setShowAddForm(false);
    setEditingProvider(null);
    setActionError(null);
  };

  const startEdit = (provider: LlmProviderSafeView) => {
    setEditingProvider(provider);
    setFormName(provider.name);
    setFormKind(provider.kind);
    setFormBaseUrl(provider.baseUrl);
    setFormModel(provider.model);
    setFormApiKey("");
    setFormCloudPdf(provider.cloudPdf);
    setFormCloudRows(provider.cloudRows);
    setShowAddForm(true);
    setActionError(null);
  };

  const executeProtectedAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (err: unknown) {
      if (
        (err as ApiError)?.code === "ReauthRequired" ||
        (err as { code?: string })?.code === "ReauthRequired"
      ) {
        setPendingAction(() => action);
        setReauthOpen(true);
      } else {
        setActionError(err instanceof Error ? err.message : "Action failed");
      }
    }
  };

  const handleReauthSuccess = async () => {
    if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      setReauthOpen(false);
      try {
        await action();
      } catch (err: unknown) {
        setActionError(
          err instanceof Error ? err.message : "Action failed after re-authentication",
        );
      }
    } else {
      setReauthOpen(false);
    }
  };

  // Form submit
  const handleSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setActionError(null);

    const action = async () => {
      if (editingProvider) {
        await updateLlmProvider(editingProvider.id, {
          name: formName,
          kind: formKind,
          baseUrl: formBaseUrl,
          model: formModel,
          apiKey: formApiKey.trim().length > 0 ? formApiKey.trim() : undefined,
          cloudPdf: formCloudPdf,
          cloudRows: formCloudRows,
        });
      } else {
        await createLlmProvider({
          name: formName,
          kind: formKind,
          baseUrl: formBaseUrl,
          model: formModel,
          apiKey: formApiKey.trim().length > 0 ? formApiKey.trim() : undefined,
          cloudPdf: formCloudPdf,
          cloudRows: formCloudRows,
        });
      }

      await queryClient.invalidateQueries({ queryKey: LLM_SETTINGS_KEY });
      await queryClient.invalidateQueries({ queryKey: LLM_PREVIEW_KEY });
      resetForm();
    };

    try {
      await executeProtectedAction(action);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete
  const handleDeleteProvider = (id: string) => {
    const action = async () => {
      await deleteLlmProvider(id);
      if (editingProvider?.id === id) resetForm();
      await queryClient.invalidateQueries({ queryKey: LLM_SETTINGS_KEY });
      await queryClient.invalidateQueries({ queryKey: LLM_PREVIEW_KEY });
    };
    void executeProtectedAction(action);
  };

  // Assign purpose
  const handleAssignPurpose = (purpose: LlmPurpose, providerId: string | null) => {
    const action = async () => {
      await assignLlmPurpose(purpose, providerId);
      await queryClient.invalidateQueries({ queryKey: LLM_SETTINGS_KEY });
      await queryClient.invalidateQueries({ queryKey: LLM_PREVIEW_KEY });
    };
    void executeProtectedAction(action);
  };

  // Test connection
  const handleTestConnection = async (id: string) => {
    setTestResults((prev) => ({
      ...prev,
      [id]: { ok: false, loading: true },
    }));

    try {
      const result = await testLlmProvider(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: result.ok, latencyMs: result.latencyMs, error: result.error, loading: false },
      }));
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          error: err instanceof Error ? err.message : "Connection test failed",
          loading: false,
        },
      }));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex text-muted-foreground" aria-hidden="true">
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </span>
            <h2 className="text-base font-semibold leading-tight">LLM providers</h2>
          </div>
          {!showAddForm ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetForm();
                setShowAddForm(true);
              }}
            >
              Add provider
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure local models (Ollama, LM Studio) or cloud endpoints (OpenAI, Anthropic) for
          categorisation, statement parsing, and set-aside row reading.
        </p>
      </div>

      {actionError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-[var(--warning-bg,#fef3c7)] px-3 py-2 text-xs text-[var(--warning,#8a5600)]"
        >
          <span className="font-bold">!</span>
          <span>{actionError}</span>
        </div>
      ) : null}

      {/* Add / Edit Form */}
      {showAddForm ? (
        <form
          onSubmit={(e) => void handleSubmitForm(e)}
          className="rounded-lg border border-border bg-card p-4 space-y-4"
          aria-label={editingProvider ? "Edit LLM provider" : "Add LLM provider"}
        >
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="text-sm font-semibold text-foreground">
              {editingProvider ? "Edit provider" : "Add provider"}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="llm-provider-name" className="text-xs font-medium text-foreground">
                Name
              </label>
              <input
                id="llm-provider-name"
                type="text"
                required
                placeholder="e.g. Ollama Local or OpenAI Cloud"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label htmlFor="llm-provider-kind" className="text-xs font-medium text-foreground">
                Provider kind
              </label>
              <select
                id="llm-provider-kind"
                value={formKind}
                onChange={(e) => setFormKind(e.target.value as LlmProviderKind)}
                className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="openai">OpenAI-compatible (/v1/chat/completions)</option>
                <option value="anthropic">Anthropic-compatible (/v1/messages)</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="llm-provider-url" className="text-xs font-medium text-foreground">
                Base URL
              </label>
              <input
                id="llm-provider-url"
                type="url"
                required
                placeholder="http://192.168.1.100:11434/v1 or https://api.openai.com/v1"
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Locality is derived automatically: LAN addresses (10.x, 192.168.x, 172.16-31.x,
                localhost, *.local) are marked local. Cloud providers default with cloud data
                opt-ins off.
              </p>
            </div>

            <div>
              <label htmlFor="llm-provider-model" className="text-xs font-medium text-foreground">
                Model name
              </label>
              <input
                id="llm-provider-model"
                type="text"
                required
                placeholder="e.g. llama3.2, gpt-4o-mini"
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
                className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div>
              <label htmlFor="llm-provider-key" className="text-xs font-medium text-foreground">
                API key {editingProvider ? "(leave blank to keep current)" : "(optional for local)"}
              </label>
              <input
                id="llm-provider-key"
                type="password"
                placeholder={
                  editingProvider?.apiKeyLast4 ? `••••••••${editingProvider.apiKeyLast4}` : "sk-..."
                }
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          {isLocalPreview ? (
            <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
              Local provider detected: requests run on your LAN with strict local privacy; cloud
              opt-ins are disabled.
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
              <div className="text-xs font-medium text-foreground">Cloud opt-ins</div>
              <p className="text-[11px] text-muted-foreground">
                Applied when the provider is outside your LAN. Categorisation sends only sanitized
                fields. PDF extraction and raw rows carry personal names and account numbers.
              </p>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={formCloudPdf}
                    onChange={(e) => setFormCloudPdf(e.target.checked)}
                    className="rounded border-input"
                  />
                  <span>Allow PDF extraction on cloud (cloud_pdf)</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={formCloudRows}
                    onChange={(e) => setFormCloudRows(e.target.checked)}
                    className="rounded border-input"
                  />
                  <span>Allow set-aside row interpretation on cloud (cloud_rows)</span>
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetForm}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : editingProvider ? "Save changes" : "Add provider"}
            </Button>
          </div>
        </form>
      ) : null}

      {/* Provider List */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configured providers
        </div>

        {providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No LLM providers configured yet. Add a local Ollama instance or cloud provider.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border list-none p-0">
            {providers.map((p) => {
              const test = testResults[p.id];
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          p.isLocal
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                        }`}
                      >
                        {p.isLocal ? "Local (LAN)" : "Cloud"}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">({p.kind})</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Model: {p.model}</span>
                      <span>URL: {p.baseUrl}</span>
                      <span>
                        Key:{" "}
                        {p.apiKeyLast4
                          ? `••••••••${p.apiKeyLast4}`
                          : p.isLocal
                            ? "None"
                            : "Not set"}
                      </span>
                    </div>

                    {!p.isLocal ? (
                      <div className="flex gap-2 text-[11px] text-muted-foreground">
                        <span>PDF: {p.cloudPdf ? "Allowed" : "Blocked"}</span>
                        <span>·</span>
                        <span>Rows: {p.cloudRows ? "Allowed" : "Blocked"}</span>
                      </div>
                    ) : null}

                    {test ? (
                      <div className="pt-1">
                        {test.loading ? (
                          <span className="text-xs text-muted-foreground">
                            Testing connectivity…
                          </span>
                        ) : test.ok ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                            ✓ Connected ({test.latencyMs}ms)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                            ✗ {test.error ?? "Failed to connect"}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestConnection(p.id)}
                      disabled={test?.loading}
                    >
                      Test connection
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(p)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteProvider(p.id)}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Purpose Assignments */}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Capability assignments
        </div>
        <p className="text-xs text-muted-foreground">
          Assign configured providers to each system capability.
        </p>

        <div className="space-y-3">
          {(["categorise", "pdf_extract", "row_interpret"] as const).map((purpose) => {
            const meta = PURPOSE_LABELS[purpose];
            const currentProviderId = assignmentMap.get(purpose) ?? "";

            return (
              <div
                key={purpose}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-foreground">{meta.title}</div>
                  <div className="text-xs text-muted-foreground">{meta.description}</div>
                </div>

                <div className="min-w-[180px]">
                  <select
                    aria-label={`Select provider for ${meta.title}`}
                    value={currentProviderId}
                    onChange={(e) =>
                      handleAssignPurpose(
                        purpose,
                        e.target.value.length > 0 ? e.target.value : null,
                      )
                    }
                    className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">None (Unassigned)</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.isLocal ? "Local" : "Cloud"})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Request Preview */}
      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Live request preview</div>
            <p className="text-xs text-muted-foreground">
              Generated by the real request builder (<code>buildCategorisationRequest</code>, AD-6).
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(!previewOpen)}
            aria-expanded={previewOpen}
          >
            {previewOpen ? "Hide preview" : "View preview"}
          </Button>
        </div>

        {previewOpen ? (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Target:</span>
                <span className="font-medium text-foreground">
                  {previewQuery.data?.provider
                    ? previewQuery.data.provider.name
                    : "No provider assigned (fallback)"}
                </span>
                {previewQuery.data?.provider ? (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.2 text-[10px] font-medium ${
                      previewQuery.data.isLocal
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                    }`}
                  >
                    {previewQuery.data.isLocal ? "Local" : "Cloud"}
                  </span>
                ) : null}
                {previewQuery.data?.model ? (
                  <span className="text-muted-foreground">({previewQuery.data.model})</span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void previewQuery.refetch()}
                disabled={previewQuery.isFetching}
              >
                {previewQuery.isFetching ? "Refreshing…" : "Refresh"}
              </Button>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground uppercase">
                System prompt
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-2.5 text-[11px] text-foreground font-mono whitespace-pre-wrap">
                {previewQuery.data?.systemPrompt ?? "Loading…"}
              </pre>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground uppercase">
                User prompt payload
              </div>
              <pre className="max-h-60 overflow-y-auto overflow-x-auto rounded-md bg-muted p-2.5 text-[11px] text-foreground font-mono whitespace-pre-wrap">
                {previewQuery.data?.prompt ?? "Loading…"}
              </pre>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Only public account transactions and category names are included. Personal accounts,
              account numbers, and partner names are never transmitted to cloud providers.
            </p>
          </div>
        ) : null}
      </div>

      <div className="text-xs text-muted-foreground">
        Adding, editing, or deleting providers and changing capability assignments asks you to
        confirm it's you.
      </div>

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauthOpen}
        action="modify LLM provider settings"
        onSuccess={handleReauthSuccess}
        onCancel={() => {
          setReauthOpen(false);
          setPendingAction(null);
        }}
      />
    </div>
  );
}
